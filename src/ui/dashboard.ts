/** Dashboard state and keyboard interaction, independent of the terminal. */

import type { AgentBackend } from "../agent/chat";
import type { JiraClient } from "../jira/client";
import { type IssueQuery, STATUSES, scoped, View, withAssignee, withView } from "../jira/query";
import { type Attachment, type Issue, isImage } from "../jira/types";
import { message, type Workspace } from "../state/workspace";
import { DEFAULT_THEME, type ThemeId } from "../theme";
import { AgentPanel } from "./agent-panel";
import { ContextPicker } from "./context-picker";
import { type Action, bindings, type Key, keyId, type SearchEdit, type Target } from "./input";
import { IssueDetails, type IssueRead } from "./issue-details";
import { IssueList } from "./issue-list";
import {
  agentLayout,
  composerMenuRows,
  listRows,
  MIN_HEIGHT,
  MIN_WIDTH,
  modalRows,
  PEEK_MIN_WIDTH,
  pickerRows,
  type SearchBoxKind,
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
  connectAgent?(theme: ThemeId): Promise<AgentBackend | undefined>;
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
  | { kind: "search"; box: ActiveSearchBox }
  | { kind: "list" };

/** The search box above the list, for the Jira query or the filter over loaded issues. */
interface SearchBox {
  kind: SearchBoxKind;
  text: string;
  placeholder: string;
}

type ActiveSearchBox = SearchBox & SearchEdit & { editing: true };
type IssueSearch = { kind: "jira"; draft: string } | { kind: "filter" };

export class Dashboard {
  readonly list: IssueList;
  private issueSearch?: IssueSearch;
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
        if (visibleInModal && this.picker?.kind === "attachment") this.picker.refresh();
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

  get canConnectAgent(): boolean {
    return !!this.options.connectAgent && this.agent.chat.canConnect;
  }

  async connectAgent(): Promise<void> {
    const connect = this.options.connectAgent;
    if (!connect) return;
    try {
      if (await this.agent.chat.connect(() => connect(this.theme))) {
        this.openAgent();
        this.notify("Agent connected");
      }
    } catch (error) {
      this.notify(message(error));
    }
  }

  get agentLayout() {
    return agentLayout(this.width, this.height, this.agent.composerRows);
  }

  get contextMenu(): Picker | undefined {
    return this.picker?.kind === "agent-context" ? this.picker : undefined;
  }

  get completionMenu(): Picker | undefined {
    const menu = this.composerMenu;
    return menu?.placement === "completion" ? menu : undefined;
  }

  get composerMenu(): Picker | undefined {
    const picker = this.picker;
    return this.agent.tab && picker && picker.placement !== "dialog" ? picker : undefined;
  }

  get composerMenuCapacity(): number {
    return composerMenuRows(this.agentLayout, this.composerMenu?.composerHeaderRows ?? 0);
  }

  setContextQuery(query: string | undefined): void {
    const menu = this.contextMenu;
    if (!menu || menu.query === query) return;
    if (query === undefined) this.closePicker();
    else {
      menu.setQuery(query);
      void this.contextPicker.lookup(query);
    }
  }

  setCommandQuery(query: string | undefined, onFinish: () => void): void {
    if (query === undefined) {
      if (this.picker?.kind === "agent-commands") this.closePicker();
      return;
    }
    if (!this.picker) this.openPicker("agent-commands", onFinish);
    const picker = this.picker;
    if (picker?.kind === "agent-commands" && picker.query !== query) picker.setQuery(query);
  }

  handleCompletion(key: Key): void {
    if (this.completionMenu) this.handlePicker(this.completionMenu, key);
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

  dispose(): Promise<void> {
    this.unsubscribe();
    this.details.dispose();
    this.images.close();
    this.closePicker();
    clearTimeout(this.noticeTimer);
    return this.agent.chat.dispose();
  }

  /** Whether the peek panel fits beside the list; narrow panes open details instead. */
  peekFits(): boolean {
    return this.width - sidebarWidth(this.width) >= PEEK_MIN_WIDTH;
  }

  private update(): void {
    this.picker?.refresh();
    this.syncPeek();
    this.redraw();
  }

  openPicker(kind: PickerKind, onFinish?: () => void): void {
    const source = PICKERS[kind];
    if (source.placement === "composer" && !this.agent.tab) this.openAgent();
    this.closePicker();
    this.picker = new Picker(kind, source.title, (query) => source.items(this, query), {
      ...source.options?.(this),
      placement: source.placement,
      onFinish,
    });
    source.load?.(this);
  }

  private closePicker({ finish = false } = {}): void {
    const picker = this.picker;
    this.picker = null;
    if (picker) PICKERS[picker.kind].close?.(this);
    if (finish) picker?.onFinish?.();
  }

  /** Close the picker and do what the chosen item does, which may open the next one. */
  private pick(item: PickerItem): void {
    this.closePicker({ finish: true });
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
    this.issueSearch ??= { kind: "jira", draft: this.workspace.query.text };
  }

  startFilter(): void {
    this.issueSearch ??= { kind: "filter" };
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
    if (this.picker && !this.completionMenu) return { kind: "picker", picker: this.picker };
    if (this.modal) return { kind: "modal", panel: this.modal };
    const box = this.searchBox();
    if (box?.editing) return { kind: "search", box };
    return { kind: this.agent.tab ? "agent" : "list" };
  }

  listCapacity(): number {
    return listRows(this.width, this.height, this.searchBox()?.kind);
  }

  searchBox(): ActiveSearchBox | (SearchBox & { editing: false }) | undefined {
    const active = this.issueSearch;
    if (active) {
      const jira = active.kind === "jira";
      return {
        kind: active.kind,
        text: jira ? active.draft : this.list.search,
        placeholder: jira ? "Search" : "Filter loaded issues",
        editing: true,
        owner: active,
        limit: 200,
        change: (text) => {
          if (jira) active.draft = text;
          else {
            this.list.filter(text);
            this.syncPeek();
          }
        },
      };
    }
    if (this.list.search) {
      return { kind: "filter", text: this.list.search, placeholder: "Filter loaded issues", editing: false };
    }
    if (this.workspace.query.view === View.Search) {
      return { kind: "jira", text: this.workspace.query.text, placeholder: "Search", editing: false };
    }
  }

  searchEdit(layer: Layer): SearchEdit | undefined {
    if (layer.kind === "picker") return layer.picker.searchEdit;
    if (layer.kind === "search") return layer.box;
  }

  /** Back to the plain list, dropping any open picker, panel or prompt. */
  private closeLayers(): void {
    this.images.close();
    this.closePicker();
    this.modal = null;
    this.issueSearch = undefined;
  }

  showView(view: View): void {
    this.closeLayers();
    this.agent.tab = false;
    this.list.unfold();
    const work = this.workspace;
    work.change(withView(work.query, view));
    this.list.filter("");
    if (view === View.Search && !work.query.text) this.startFind();
  }

  /** Esc on search results: clear them and type a new search, staying on the tab. */
  private clearSearch(): void {
    this.workspace.change(scoped(this.workspace.query, { text: "" }));
    this.list.filter("");
    this.startFind();
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
        this.closePicker();
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
      case "search":
        this.handleSearch(layer.box, id);
        break;
      case "list":
        if (id === "q" || id === "ctrl-c") return false;
        // Space can't sit in a space-separated binding table.
        if (id === " ") this.runAction("peek");
        else if (this.peek && "name" in key && key.shift && (id === "up" || id === "down"))
          this.scrollPeek(id === "down" ? 1 : -1);
        else this.listKeys.get(id)?.();
    }
    this.syncPeek();
    return true;
  }

  private handlePicker(picker: Picker, key: Key): void {
    const inline = picker === this.composerMenu;
    const selectionKey: Key = inline && keyId(key) === "tab" ? { name: "enter" } : key;
    const picked = picker.handle(selectionKey, inline ? this.composerMenuCapacity : pickerRows(this.height));
    if (picked === "dismiss") this.closePicker({ finish: true });
    else if (picked) this.pick(picked);
  }

  private handleSearch(box: ActiveSearchBox, id: string): void {
    if (id === "escape" || id === "ctrl-c") {
      this.issueSearch = undefined;
      if (id === "ctrl-c" && box.kind === "filter") this.list.filter("");
    } else if (id === "enter") {
      const text = box.text.trim();
      if (box.kind === "jira" && !text) return;
      this.issueSearch = undefined;
      if (box.kind === "jira") {
        this.workspace.change(scoped(this.workspace.query, { view: View.Search, text }));
        this.list.filter("");
      }
    }
  }

  click(target?: Target): void {
    // A dialog consumes outside clicks. The Agent menu dismisses and lets them through.
    if (this.picker && target?.kind !== "choice" && target?.kind !== "dialog") {
      const inline = !!this.composerMenu;
      this.closePicker({ finish: target?.kind === "dismiss" });
      if (!inline) return;
    }
    if (!target) return;
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
        this.showView(target.view);
        return;
      case "issue": {
        // The first click selects; a click on the selected issue opens it.
        const issue = this.list.click(target.key);
        if (issue) this.openDetail(issue);
        return;
      }
      case "box":
        if (this.searchBox()?.kind === "jira") this.startFind();
        else this.startFilter();
        return;
      case "choice": {
        const picked = this.picker?.choice(target.value);
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
      if (this.completionMenu && (over?.kind === "choice" || over?.kind === "dialog")) this.completionMenu.move(delta);
      else this.agent.wheel(delta, this.agentLayout);
    } else if (layer.kind === "picker") {
      layer.picker.move(delta);
    } else if (layer.kind === "modal") {
      layer.panel.scroll = Math.max(0, layer.panel.scroll + delta * WHEEL_LINES);
    } else if (layer.kind === "list" || layer.kind === "search") {
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
    "/": () => this.startFilter(),
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
