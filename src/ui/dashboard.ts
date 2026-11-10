/** Dashboard state and keyboard interaction, independent of the terminal. */

import type { AgentBackend } from "../agent/chat";
import type { JiraClient } from "../jira/client";
import { type IssueQuery, STATUSES, scoped, View, withAssignee, withView } from "../jira/query";
import { type Attachment, type Issue, isImage } from "../jira/types";
import { message, type Workspace } from "../state/workspace";
import { DEFAULT_THEME, type ThemeId } from "../theme";
import { AgentPanel } from "./agent-panel";
import { ContextPicker } from "./context-picker";
import { type Action, bindings, editLine, type Key, keyId, type Target } from "./input";
import { IssueDetails, type IssueRead } from "./issue-details";
import { IssueList } from "./issue-list";
import {
  agentLayout,
  listRows,
  MIN_HEIGHT,
  MIN_WIDTH,
  modalRows,
  PEEK_MIN_WIDTH,
  pickerRows,
  sidebarWidth,
} from "./layout";
import { MY_ISSUES_TABS, NAV_VIEWS, NAVIGATION, navKey, pageOf } from "./navigation";
import { helpPanel, type Panel, sprintPanel } from "./panel";
import type { Peek } from "./peek";
import { Picker, type PickerItem, type PickerKind } from "./picker";
import { openSprintFilter, PICKERS } from "./pickers";
import { ImagePreviews, type Preview } from "./preview";

export interface Opener {
  open(url: string): Promise<void>;
  copy(text: string): Promise<void>;
}

export interface DashboardOptions {
  agent?: AgentBackend;
  appearance?: { initial?: ThemeId; save(theme: ThemeId): void };
}

const NOTICE_MS = 4000;
const WHEEL_LINES = 3;

/** What receives input, topmost first. Prompts belong to the list screen. */
export type Layer =
  | { kind: "too-small" }
  | { kind: "agent" }
  | { kind: "preview"; preview: Preview }
  | { kind: "picker"; picker: Picker }
  | { kind: "modal"; panel: Panel }
  | { kind: "find"; draft: string }
  | { kind: "filter" }
  | { kind: "list" };

/** The search box above the list: Jira search in the Search view, or the
 * filter over loaded issues. `editing` shows the cursor. */
export interface SearchBox {
  kind: "jira" | "filter";
  text: string;
  editing: boolean;
}

export class Dashboard {
  readonly list: IssueList;
  searching = false;
  /** Words typed after f, not yet sent to Jira; null when not typing. */
  finding: string | null = null;
  personLabel = "All people";
  picker: Picker | null = null;
  modal: Panel | null = null;
  /** A short confirmation or error after open/copy; it clears itself. */
  notice = "";
  height = 24;
  width = 120;
  /** The peek panel beside the list; Space toggles it. */
  peekOpen = false;
  peek: Peek | null = null;
  readonly agent: AgentPanel;
  readonly contextPicker: ContextPicker;
  private selectedTheme: ThemeId;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly images: ImagePreviews;
  private readonly details: IssueDetails;
  private readonly unsubscribe: () => void;

  constructor(
    readonly workspace: Workspace,
    private readonly client: Pick<JiraClient, "detail" | "attachment" | "site" | "findIssues">,
    private readonly opener: Opener,
    private readonly redraw: () => void,
    private readonly options: DashboardOptions = {},
  ) {
    this.selectedTheme = options.appearance?.initial ?? DEFAULT_THEME;
    this.list = new IssueList(workspace);
    this.images = new ImagePreviews((id) => client.attachment(id), redraw);
    this.agent = new AgentPanel(options.agent, redraw, () => this.update());
    this.contextPicker = new ContextPicker(
      (text, signal) => client.findIssues(text, signal),
      () => this.update(),
    );
    this.details = new IssueDetails(
      (key) => client.detail(key),
      (read) => {
        const visibleInModal = this.modal?.kind === "issue" && this.modal.read === read;
        if (visibleInModal && this.picker?.kind === "attachment") this.refreshPicker();
        if (visibleInModal || this.peek?.read === read) this.redraw();
      },
    );
    this.unsubscribe = workspace.subscribe(() => this.update());
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const peekFit = this.peekFits();
    this.width = width;
    this.height = height;
    if (peekFit !== this.peekFits()) this.syncPeek();
  }

  get agentLayout() {
    return agentLayout(this.width - sidebarWidth(this.width), this.height, this.agent.composerRows);
  }

  get site(): string {
    return this.client.site;
  }

  get theme(): ThemeId {
    return this.selectedTheme;
  }

  chooseTheme(theme: ThemeId): void {
    this.selectedTheme = theme;
    try {
      this.options.appearance?.save(theme);
    } catch (error) {
      this.notify(`Could not save theme: ${message(error)}`);
      return;
    }
    this.redraw();
  }

  dispose(): void {
    this.unsubscribe();
    this.details.dispose();
    this.images.close();
    this.closePicker();
    this.agent.dispose();
    clearTimeout(this.noticeTimer);
  }

  /** Whether the peek panel fits beside the list; narrow panes open details instead. */
  peekFits(): boolean {
    return this.width - sidebarWidth(this.width) >= PEEK_MIN_WIDTH;
  }

  private update(): void {
    this.refreshPicker();
    this.syncPeek();
    this.redraw();
  }

  private refreshPicker(): void {
    const picker = this.picker;
    if (picker) picker.replace(PICKERS[picker.kind].items(this, picker.query));
  }

  openPicker(kind: PickerKind): void {
    this.closePicker();
    const source = PICKERS[kind];
    this.picker = new Picker(kind, source.title, source.items(this, ""), source.options?.(this));
    source.load?.(this);
  }

  private closePicker(): void {
    const picker = this.picker;
    this.picker = null;
    if (picker) PICKERS[picker.kind].close?.(this);
  }

  /** Close the picker and do what the chosen item does, which may open the next one. */
  private pick(item: PickerItem): void {
    this.closePicker();
    item.run();
  }

  changeQuery(change: Partial<IssueQuery>): void {
    this.list.filter("");
    this.workspace.change(scoped(this.workspace.query, change));
  }

  chooseBoard(board: string): void {
    if (board !== this.workspace.board && this.workspace.query.sprintFilter !== null) this.list.filter("");
    this.workspace.chooseBoard(board);
  }

  chooseAssignee(assignee: string, label: string): void {
    this.list.filter("");
    this.personLabel = label;
    this.workspace.change(withAssignee(this.workspace.query, assignee));
  }

  /** Images preview over the details panel; other files open in Helium. */
  openAttachment(item: Attachment): void {
    if (isImage(item)) this.images.open(this.attachments.filter(isImage), item);
    else this.openUrl(this.attachmentUrl(item), "Opened attachment");
  }

  /** A header, footer or peek button, or its key. */
  runAction(action: Action): void {
    switch (action) {
      case "filter":
      case "display":
      case "commands":
      case "model":
      case "reasoning":
        this.openPicker(action);
        return;
      case "brief": {
        const sprint = this.workspace.sprint();
        if (sprint) this.modal = sprintPanel(sprint);
        return;
      }
      case "peek": {
        const issue = this.list.selected;
        if (!issue) return;
        if (this.peekFits()) this.peekOpen = !this.peekOpen;
        else this.openDetail(issue);
        return;
      }
      case "details": {
        const issue = this.list.selected;
        if (issue) this.openDetail(issue);
        return;
      }
      case "refresh":
        this.workspace.refresh();
        this.workspace.retryCatalogs();
        return;
      case "help":
        this.modal = helpPanel();
        return;
      case "load-more":
        this.workspace.loadMore();
        return;
    }
  }

  clearFilters(): void {
    const { query } = this.workspace;
    this.list.filter("");
    if (!query.project && !query.assignee && query.status === "all" && query.sprintFilter === null) return;
    this.personLabel = "All people";
    this.workspace.change(scoped(query, { project: "", assignee: "", status: "all", sprintFilter: null }));
  }

  openAgent(): void {
    this.closeLayers();
    this.agent.tab = true;
  }

  startFind(): void {
    this.finding = this.workspace.query.text;
  }

  /** Keep the peek panel on the selected issue, loading its details once. */
  private syncPeek(): void {
    const issue = this.peekOpen && this.peekFits() ? this.list.selected : undefined;
    if (!issue) {
      this.peek = null;
      return;
    }
    if (this.peek?.issue.key === issue.key) {
      this.peek.issue = issue;
      return;
    }
    this.peek = { issue, read: this.readIssue(issue.key), scroll: 0 };
  }

  openDetail(issue: Issue): void {
    this.modal = { kind: "issue", issue, read: this.readIssue(issue.key), scroll: 0 };
  }

  get attachments(): Attachment[] {
    return this.modal?.kind === "issue" ? (this.modal.read.state.data?.attachments ?? []) : [];
  }

  private readIssue(key: string): IssueRead {
    const modal = this.modal;
    if (modal?.kind === "issue" && modal.issue.key === key) return modal.read;
    if (this.peek?.issue.key === key) return this.peek.read;
    return this.details.open(key);
  }

  private attachmentUrl(item: Attachment): string {
    return `https://${this.site}/secure/attachment/${encodeURIComponent(item.id)}/${encodeURIComponent(item.filename)}`;
  }

  get preview(): Preview | null {
    return this.images.current;
  }

  /** Open the shown issue in Helium, or copy its link. */
  openIssue(copy: boolean): void {
    if (this.modal?.kind === "text") return;
    const issue = this.modal?.issue ?? this.list.selected;
    if (!issue) return;
    const url = `https://${this.site}/browse/${issue.key}`;
    if (copy) this.report(this.opener.copy(url), "Link copied");
    else this.openUrl(url, "Opened in Helium");
  }

  private openUrl(url: string, notice: string): void {
    this.report(this.opener.open(url), notice);
  }

  private report(action: Promise<void>, notice: string): void {
    action.then(
      () => this.notify(notice),
      (error: unknown) => this.notify(message(error)),
    );
  }

  private notify(notice: string): void {
    this.notice = notice;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = "";
      this.redraw();
    }, NOTICE_MS);
    this.redraw();
  }

  layer(): Layer {
    if (this.width < MIN_WIDTH || this.height < MIN_HEIGHT) return { kind: "too-small" };
    if (this.preview) return { kind: "preview", preview: this.preview };
    if (this.picker) return { kind: "picker", picker: this.picker };
    if (this.modal) return { kind: "modal", panel: this.modal };
    if (this.finding !== null) return { kind: "find", draft: this.finding };
    if (this.searching) return { kind: "filter" };
    return { kind: this.agent.tab ? "agent" : "list" };
  }

  listCapacity(): number {
    return listRows(this.height, this.searchBox() !== null);
  }

  searchBox(): SearchBox | null {
    if (this.finding !== null) return { kind: "jira", text: this.finding, editing: true };
    if (this.searching || this.list.search) return { kind: "filter", text: this.list.search, editing: this.searching };
    if (this.workspace.query.view === View.Search)
      return { kind: "jira", text: this.workspace.query.text, editing: false };
    return null;
  }

  /** Back to the plain list, dropping any open picker, panel or prompt. */
  private closeLayers(): void {
    this.images.close();
    this.closePicker();
    this.modal = null;
    this.finding = null;
    this.searching = false;
  }

  showView(view: View): void {
    this.agent.tab = false;
    this.list.unfold();
    const work = this.workspace;
    work.change(withView(work.query, view));
    this.list.filter("");
    if (view === View.Search && !work.query.text) this.finding = "";
  }

  /** Esc on search results: clear them and type a new search, staying on the tab. */
  private clearSearch(): void {
    this.workspace.change(scoped(this.workspace.query, { text: "" }));
    this.list.filter("");
    this.finding = "";
  }

  private cycleStatus(): void {
    const { query } = this.workspace;
    const status = STATUSES[(STATUSES.indexOf(query.status) + 1) % STATUSES.length] ?? "all";
    this.workspace.change(scoped(query, { status }));
    this.list.first();
  }

  /** Route a key to the active layer; returns false to quit. */
  handle(key: Key): boolean {
    const id = keyId(key);
    const layer = this.layer();
    if (layer.kind === "too-small") return id !== "q" && id !== "ctrl-c";
    if (id === "commands") {
      this.click({ kind: "action", action: "commands" });
      return true;
    }
    switch (layer.kind) {
      case "agent":
        if (id === "agent-cited") this.openPicker("cited");
        else this.agent.key(key, this.agentLayout);
        return true;
      case "preview":
        this.previewKeys.get(id)?.(layer.preview);
        break;
      case "picker":
        this.handlePicker(layer.picker, key);
        break;
      case "modal":
        this.modalKeys.get(id)?.(layer.panel);
        break;
      case "find":
        this.handleFind(layer.draft, key);
        break;
      case "filter":
        this.handleSearch(key);
        break;
      case "list":
        if (id === "q" || id === "ctrl-c") return false;
        // Space can't sit in a space-separated binding table.
        if (id === " ") this.runAction("peek");
        else this.listKeys.get(id)?.();
    }
    this.syncPeek();
    return true;
  }

  private handlePicker(picker: Picker, key: Key): void {
    const before = picker.query;
    const picked = picker.handle(key, pickerRows(this.height));
    if (picked === "dismiss") this.closePicker();
    else if (picked) this.pick(picked);
    else if (before !== picker.query) PICKERS[picker.kind].queryChanged?.(this, picker.query);
  }

  private handleSearch(key: Key): void {
    const edited = editLine(this.list.search, key, 200);
    if (edited !== undefined) this.list.filter(edited);
    else if (keyId(key) === "enter" || keyId(key) === "escape") this.searching = false;
    else if (keyId(key) === "ctrl-c") {
      this.searching = false;
      this.list.filter("");
    }
  }

  private handleFind(draft: string, key: Key): void {
    const edited = editLine(draft, key, 200);
    if (edited !== undefined) {
      this.finding = edited;
    } else if (keyId(key) === "enter" && draft.trim()) {
      this.finding = null;
      this.workspace.change(scoped(this.workspace.query, { view: View.Search, text: draft.trim() }));
      this.list.filter("");
    } else if (keyId(key) === "escape" || keyId(key) === "ctrl-c") {
      this.finding = null;
    }
  }

  click(target: Target): void {
    // A dialog takes the clicks: a choice picks, a click elsewhere closes it.
    if (this.picker && target.kind !== "choice" && target.kind !== "dialog") {
      this.closePicker();
      return;
    }
    this.clickTarget(target);
    this.syncPeek();
  }

  private clickTarget(target: Target): void {
    switch (target.kind) {
      case "action":
        this.closeLayers();
        this.runAction(target.action);
        return;
      case "group":
        this.list.toggle(target.label);
        return;
      case "agent":
        this.agentClick(target.action);
        return;
      case "agent-cite": {
        const issue = this.agent.chat.current.issues.get(target.key);
        if (!issue) return;
        this.images.close();
        this.closePicker();
        this.openDetail(issue);
        return;
      }
      case "view":
        this.closeLayers();
        this.showView(target.view);
        return;
      case "issue": {
        // The first click selects; a click on the selected issue opens it.
        const issue = this.list.click(target.key);
        if (issue) this.openDetail(issue);
        return;
      }
      case "box":
        if (this.searchBox()?.kind === "jira") this.finding ??= this.workspace.query.text;
        else this.searching = true;
        return;
      case "choice": {
        const picked = this.picker?.click(target.value);
        if (picked) this.pick(picked);
        return;
      }
      case "peek":
      case "dialog":
      case "dismiss":
        return;
    }
  }

  private agentClick(action: Extract<Target, { kind: "agent" }>["action"]): void {
    const { chat } = this.agent;
    switch (action) {
      case "tab":
        this.openAgent();
        return;
      case "new":
        chat.start();
        return;
      case "previous":
      case "next":
        chat.select(action === "previous" ? -1 : 1);
        return;
    }
  }

  private scrollPeek(delta: number): void {
    if (this.peek) this.peek.scroll = Math.max(0, this.peek.scroll + delta * WHEEL_LINES);
  }

  /** The mouse wheel: `delta` is +1 per notch down, -1 per notch up.
   * `over` is what the pointer is on, so the peek scrolls itself. */
  wheel(delta: -1 | 1, over?: Target): void {
    const layer = this.layer();
    if (over?.kind === "peek" && this.peek && layer.kind === "list") {
      this.scrollPeek(delta);
    } else if (layer.kind === "agent") {
      this.agent.wheel(delta, this.agentLayout);
    } else if (layer.kind === "picker") {
      layer.picker.move(delta);
    } else if (layer.kind === "modal") {
      layer.panel.scroll = Math.max(0, layer.panel.scroll + delta * WHEEL_LINES);
    } else if (layer.kind === "list" || layer.kind === "filter" || layer.kind === "find") {
      this.list.move(delta);
      this.syncPeek();
    }
  }

  private readonly modalKeys = bindings<(panel: Panel) => void>({
    "q escape ctrl-c": () => {
      this.modal = null;
    },
    "j down": (panel) => {
      panel.scroll += 1;
    },
    "k up": (panel) => {
      panel.scroll -= 1;
    },
    pagedown: (panel) => {
      panel.scroll += modalRows(this.height);
    },
    pageup: (panel) => {
      panel.scroll -= modalRows(this.height);
    },
    home: (panel) => {
      panel.scroll = 0;
    },
    end: (panel) => {
      panel.scroll = Number.MAX_SAFE_INTEGER;
    },
    o: () => this.openIssue(false),
    y: () => this.openIssue(true),
    i: () => {
      const attachments = this.attachments;
      const [first] = attachments;
      if (!first) return;
      if (attachments.length === 1 && isImage(first)) this.openAttachment(first);
      else this.openPicker("attachment");
    },
    r: (panel) => {
      if (panel.kind === "issue") void this.details.reload(panel.read);
    },
  });

  private readonly previewKeys = bindings<(preview: Preview) => void>({
    "q escape ctrl-c": () => {
      this.images.close();
    },
    "right l j down pagedown": () => this.images.step(1),
    "left h k up pageup": () => this.images.step(-1),
    o: (preview) => {
      this.openUrl(this.attachmentUrl(preview.image), "Opened in Helium");
    },
  });

  private readonly listKeys = bindings<() => void>({
    // Esc steps back: first the peek, then the filter, then the Jira search.
    escape: () => {
      if (this.peekOpen) this.peekOpen = false;
      else if (!this.list.search && this.workspace.query.text && this.workspace.query.view === View.Search)
        this.clearSearch();
      else this.list.filter("");
    },
    "/": () => {
      this.searching = true;
    },
    F: () => this.runAction("filter"),
    D: () => this.runAction("display"),
    z: () => this.list.foldSelected(),
    Z: () => this.list.unfold(),
    "left right": () => {
      const tabs = MY_ISSUES_TABS.map(([view]) => view);
      const at = tabs.indexOf(this.workspace.query.view);
      if (at >= 0) this.showView(tabs[(at + 1) % tabs.length] ?? View.Mine);
    },
    J: () => this.scrollPeek(1),
    K: () => this.scrollPeek(-1),
    f: () => this.startFind(),
    tab: () => {
      // Created is a tab of My issues, so Tab moves on from the page, not the tab.
      const here = pageOf(this.workspace.query.view);
      const next = NAV_VIEWS[(NAV_VIEWS.findIndex((view) => pageOf(view) === here) + 1) % NAV_VIEWS.length];
      if (next !== undefined) this.showView(next);
    },
    ...Object.fromEntries(
      NAVIGATION.map((page) => [navKey(page), () => (page.to === "agent" ? this.openAgent() : this.showView(page.to))]),
    ),
    "j down": () => this.list.move(1),
    "k up": () => this.list.move(-1),
    pagedown: () => this.list.page(1, this.listCapacity()),
    pageup: () => this.list.page(-1, this.listCapacity()),
    home: () => this.list.first(),
    end: () => this.list.last(),
    "enter v": () => this.runAction("details"),
    "?": () => this.runAction("help"),
    t: () => this.runAction("brief"),
    r: () => this.runAction("refresh"),
    o: () => this.openIssue(false),
    y: () => this.openIssue(true),
    b: () => this.openPicker("board"),
    s: () => openSprintFilter(this),
    p: () => this.openPicker("project"),
    a: () => this.openPicker("assignee"),
    d: () => this.cycleStatus(),
    g: () => this.list.groupBy(this.list.grouping === "status" ? "assignee" : "status"),
    n: () => this.runAction("load-more"),
  });
}
