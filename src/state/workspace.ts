/** Async view state: keep successful results and reject responses for old scopes. */

import type { Catalog, Snapshot } from "../jira/client";
import { type IssueQuery, initialQuery, isReady, PAGE, sameQuery, sameScope, scoped, View } from "../jira/query";
import type { Choice, Issue, Sprint } from "../jira/types";
import { clean } from "../text";

export interface Source {
  snapshot(query: IssueQuery): Promise<Snapshot>;
  catalog(): Promise<Catalog>;
  sprints(board: string): Promise<Sprint[]>;
}

export const REFRESH_MS = 60_000;
/** Boards checked for active sprints when no board is remembered. */
const DEFAULT_BOARD_CANDIDATES = 20;

export const message = (error: unknown): string => clean(error instanceof Error ? error.message : String(error), true);

const SCOPE_LABELS: Record<Exclude<View, typeof View.Sprint | typeof View.Search>, string> = {
  [View.All]: "Everyone's tasks",
  [View.Mine]: "Assigned to me",
  [View.Created]: "Created by me",
  [View.Today]: "Needs attention",
  [View.Mentions]: "Mentioning me",
};

export class Workspace {
  query: IssueQuery = initialQuery;
  snapshot: Snapshot | null = null;
  updated: Date | null = null;
  /** The scope being loaded, if any. */
  pendingQuery: IssueQuery | null = null;
  error = "";
  boards: Choice[] = [];
  projects: Choice[] = [];
  board = "";
  sprints: Sprint[] = [];
  catalogPending = false;
  sprintsPending = false;
  catalogError = "";

  private request = 0;
  private nextRefresh = Number.POSITIVE_INFINITY;
  private nextCatalogRetry = Number.POSITIVE_INFINITY;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly source: Source,
    private readonly options: {
      preferredBoard?: string;
      rememberBoard?: (board: string) => void;
      now?: () => number;
    } = {},
  ) {}

  /** Call `listener` after every state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  get current(): boolean {
    return this.snapshot !== null && sameScope(this.snapshot.query, this.query);
  }

  get issues(): Issue[] {
    return this.current && this.snapshot ? this.snapshot.issues : [];
  }

  get more(): boolean {
    return this.current && Boolean(this.snapshot?.more);
  }

  get pending(): boolean {
    return this.pendingQuery !== null;
  }

  change(query: IssueQuery): void {
    if (sameQuery(query, this.query)) return;
    this.query = query;
    this.error = "";
    this.nextRefresh = 0;
    this.load();
    this.changed();
  }

  /** Reload the current scope now. */
  refresh(): void {
    this.load();
    this.changed();
  }

  /** Load the current scope, unless that exact request is already running.
   * A request for an older scope is dropped rather than waited for. */
  private load(): void {
    if (!isReady(this.query)) return;
    if (this.pendingQuery && sameQuery(this.pendingQuery, this.query)) return;
    const id = ++this.request;
    const requested = this.query;
    this.error = "";
    this.pendingQuery = requested;
    this.source.snapshot(requested).then(
      (snapshot) =>
        this.settle(id, requested, () => {
          if (sameQuery(snapshot.query, this.query)) {
            this.snapshot = snapshot;
            this.updated = new Date(this.now());
          }
        }),
      (error: unknown) =>
        this.settle(id, requested, () => {
          if (sameQuery(requested, this.query)) this.error = message(error);
        }),
    );
  }

  private settle(id: number, requested: IssueQuery, apply: () => void): void {
    if (id !== this.request) return; // superseded by a newer request
    apply();
    this.pendingQuery = null;
    const stale = !sameQuery(requested, this.query);
    this.nextRefresh = stale ? 0 : this.now() + REFRESH_MS;
    this.tick();
    this.changed();
  }

  /** Called every second: refresh on schedule and retry failed catalogs.
   * Anything that starts notifies subscribers, so the screen needs no timer. */
  tick(): void {
    const now = this.now();
    if (!this.pending && now >= this.nextRefresh) this.refresh();
    if (this.catalogError && now >= this.nextCatalogRetry) {
      this.nextCatalogRetry = Number.POSITIVE_INFINITY;
      this.retryCatalogs();
    }
  }

  loadMore(): void {
    if (this.more && this.snapshot?.query.limit === this.query.limit) {
      this.change({ ...this.query, limit: this.query.limit + PAGE });
    }
  }

  loadCatalog(): void {
    if (this.catalogPending) return;
    this.catalogPending = true;
    this.catalogError = "";
    this.changed();
    this.source
      .catalog()
      .then(
        (catalog) => {
          this.boards = catalog.boards;
          this.projects = catalog.projects;
          if (!this.board) this.openDefaultBoard();
        },
        (error: unknown) => this.catalogFailed(error),
      )
      .finally(() => {
        this.catalogPending = false;
        this.changed();
      });
  }

  /** The user picked a board: open it now and on the next start. */
  chooseBoard(board: string): void {
    this.options.rememberBoard?.(board);
    this.openBoard(board);
  }

  /** Open the remembered board, else the one with the most active sprints. */
  private openDefaultBoard(): void {
    const remembered = this.boards.find((b) => b.value === this.options.preferredBoard);
    if (remembered) {
      this.openBoard(remembered.value);
      return;
    }
    const candidates = this.boards.slice(0, DEFAULT_BOARD_CANDIDATES);
    void Promise.all(
      candidates.map((board) =>
        this.source.sprints(board.value).then(
          (sprints) => ({ board: board.value, sprints }),
          () => ({ board: board.value, sprints: [] }),
        ),
      ),
    ).then((found) => {
      if (this.board) return; // the user chose a board meanwhile
      const active = (sprints: Sprint[]) => sprints.filter((s) => s.state === "active").length;
      const best = found.reduce<(typeof found)[number] | undefined>(
        (top, next) => (!top || active(next.sprints) > active(top.sprints) ? next : top),
        undefined,
      );
      if (best) this.openBoard(best.board, best.sprints);
    });
  }

  private openBoard(board: string, sprints?: Sprint[]): void {
    this.board = board;
    this.sprints = sprints ?? [];
    this.catalogError = "";
    this.change(scoped(this.query, { sprint: null }));
    if (sprints) this.changed();
    else this.loadSprints();
  }

  loadSprints(): void {
    if (!this.board || this.sprintsPending) return;
    const board = this.board;
    this.sprintsPending = true;
    this.changed();
    this.source
      .sprints(board)
      .then(
        (sprints) => {
          if (board === this.board) this.sprints = sprints;
        },
        (error: unknown) => {
          if (board === this.board) this.catalogFailed(error);
        },
      )
      .finally(() => {
        this.sprintsPending = false;
        if (board !== this.board) this.loadSprints();
        this.changed();
      });
  }

  /** Reload whichever board, project or sprint list failed or is missing. */
  retryCatalogs(): void {
    const failed = Boolean(this.catalogError);
    if (failed || this.boards.length === 0) this.loadCatalog();
    if (this.board && (failed || this.sprints.length === 0)) this.loadSprints();
  }

  private catalogFailed(error: unknown): void {
    this.catalogError = message(error);
    this.nextCatalogRetry = this.now() + REFRESH_MS;
  }

  sprint(): Sprint | undefined {
    return this.sprints.find((sprint) => sprint.id === this.query.sprint);
  }

  scope(): string {
    const { project, status } = this.query;
    return `${this.label()} · ${project || "all projects"} · ${status} statuses`;
  }

  private label(): string {
    const { view, text } = this.query;
    if (view === View.Sprint) return this.sprint()?.name ?? "Choose a sprint with s";
    if (view === View.Search) return text ? `Search: ${text}` : "Press f to search all of Jira";
    return SCOPE_LABELS[view];
  }
}
