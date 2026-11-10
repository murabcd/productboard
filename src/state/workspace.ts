/** Async view state: keep successful results and reject responses for old scopes. */

import type { Catalog, Snapshot } from "../jira/client";
import { type IssueQuery, initialQuery, isReady, PAGE, sameQuery, sameScope, scoped } from "../jira/query";
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

export class Workspace {
  query: IssueQuery = initialQuery;
  snapshot: Snapshot | null = null;
  updated: Date | null = null;
  error = "";
  boards: Choice[] = [];
  projects: Choice[] = [];
  board = "";
  sprints: Sprint[] = [];
  catalogPending = false;
  boardCatalogError = "";
  sprintCatalogError = "";

  private request: { query: IssueQuery } | undefined;
  private sprintRequest: { board: string } | undefined;
  private nextRefresh = Number.POSITIVE_INFINITY;
  private catalogRetryAt = Number.POSITIVE_INFINITY;
  private sprintsRetryAt = Number.POSITIVE_INFINITY;
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
    return this.request !== undefined;
  }

  get sprintsPending(): boolean {
    return this.sprintRequest !== undefined;
  }

  get catalogError(): string {
    return this.boardCatalogError || this.sprintCatalogError;
  }

  change(query: IssueQuery): void {
    if (sameQuery(query, this.query)) return;
    this.query = query;
    this.request = undefined;
    this.error = "";
    this.nextRefresh = Number.POSITIVE_INFINITY;
    this.refresh();
  }

  refresh(): void {
    void this.load();
    this.changed();
  }

  /** Load the current scope, unless that exact request is already running.
   * A request for an older scope is dropped rather than waited for. */
  private async load(): Promise<void> {
    if (!isReady(this.query) || this.request) return;
    const request = { query: this.query };
    this.request = request;
    this.error = "";
    try {
      const snapshot = await this.source.snapshot(request.query);
      if (this.request === request && sameQuery(snapshot.query, request.query)) {
        this.snapshot = snapshot;
        this.updated = new Date(this.now());
      }
    } catch (error) {
      if (this.request === request) this.error = message(error);
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.nextRefresh = this.now() + REFRESH_MS;
        this.changed();
      }
    }
  }

  /** Called every second: refresh on schedule and retry failed catalogs.
   * Anything that starts notifies subscribers, so the screen needs no timer. */
  tick(): void {
    const now = this.now();
    if (!this.pending && now >= this.nextRefresh) this.refresh();
    if (now >= this.catalogRetryAt) this.loadCatalog();
    if (now >= this.sprintsRetryAt) void this.loadSprints();
  }

  loadMore(): void {
    if (this.more && this.snapshot?.query.limit === this.query.limit) {
      this.change({ ...this.query, limit: this.query.limit + PAGE });
    }
  }

  loadCatalog(): void {
    if (this.catalogPending) return;
    this.catalogPending = true;
    this.boardCatalogError = "";
    this.catalogRetryAt = Number.POSITIVE_INFINITY;
    this.changed();
    this.source
      .catalog()
      .then(
        (catalog) => {
          this.boards = catalog.boards;
          this.projects = catalog.projects;
          if (!this.board) this.openDefaultBoard();
        },
        (error: unknown) => {
          this.boardCatalogError = message(error);
          this.catalogRetryAt = this.now() + REFRESH_MS;
        },
      )
      .finally(() => {
        this.catalogPending = false;
        this.changed();
      });
  }

  /** The user picked a board: open it now and on the next start. */
  chooseBoard(board: string): void {
    if (board === this.board) return;
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
    this.sprintRequest = undefined;
    this.sprints = sprints ?? [];
    this.sprintCatalogError = "";
    this.sprintsRetryAt = Number.POSITIVE_INFINITY;
    this.change(scoped(this.query, { sprint: null, sprintFilter: null }));
    if (sprints) this.changed();
    else void this.loadSprints();
  }

  async loadSprints(): Promise<void> {
    if (!this.board || this.sprintRequest) return;
    const request = { board: this.board };
    this.sprintRequest = request;
    this.sprintCatalogError = "";
    this.sprintsRetryAt = Number.POSITIVE_INFINITY;
    this.changed();
    try {
      const sprints = await this.source.sprints(request.board);
      if (this.sprintRequest === request) this.sprints = sprints;
    } catch (error) {
      if (this.sprintRequest === request) {
        this.sprintCatalogError = message(error);
        this.sprintsRetryAt = this.now() + REFRESH_MS;
      }
    } finally {
      if (this.sprintRequest === request) {
        this.sprintRequest = undefined;
        this.changed();
      }
    }
  }

  /** Reload whichever board, project or sprint list failed or is missing. */
  retryCatalogs(): void {
    if (this.boardCatalogError || this.boards.length === 0) this.loadCatalog();
    if (this.sprintCatalogError || this.sprints.length === 0) void this.loadSprints();
  }

  sprint(id = this.query.sprint): Sprint | undefined {
    return this.sprints.find((sprint) => sprint.id === id);
  }
}
