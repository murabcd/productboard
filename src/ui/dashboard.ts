/** Dashboard state and keyboard interaction, independent of the terminal. */

import type { AgentBackend } from "../agent/chat";
import type { JiraClient } from "../jira/client";
import { type IssueQuery, STATUSES, scoped, View, withAssignee, withView } from "../jira/query";
import { type Attachment, type Issue, isImage } from "../jira/types";
import { message, type Workspace } from "../state/workspace";
import { AgentPanel } from "./agent-panel";
import { type Group, type Grouping, groupIssues } from "./grouping";
import { type Action, bindings, editLine, type Key, keyId, type Target } from "./input";
import { listRows, modalRows, PEEK_MIN_WIDTH, pickerRows, sidebarWidth } from "./layout";
import { MY_ISSUES_TABS, NAV_VIEWS, NAVIGATION, navKey, pageOf } from "./navigation";
import { helpPanel, issuePanel, type Panel, showDetail, sprintPanel } from "./panel";
import type { Peek } from "./peek";
import { Picker, type PickerItem, type PickerKind } from "./picker";
import { type FilterChip, filterChips, PICKERS } from "./pickers";
import { currentImage, ImageCache, type Preview, previewOf } from "./preview";

export interface Opener {
  open(url: string): Promise<void>;
  copy(text: string): Promise<void>;
}

const NOTICE_MS = 4000;
const WHEEL_LINES = 3;

/** What receives input, topmost first. Prompts belong to the list screen. */
export type Layer =
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
  index = 0;
  offset = 0;
  search = "";
  searching = false;
  /** Words typed after f, not yet sent to Jira; null when not typing. */
  finding: string | null = null;
  grouping: Grouping = "status";
  personLabel = "All people";
  picker: Picker | null = null;
  modal: Panel | null = null;
  preview: Preview | null = null;
  /** A short confirmation or error after open/copy; it clears itself. */
  notice = "";
  height = 24;
  width = 120;
  /** The peek panel beside the list; Space toggles it. */
  peekOpen = false;
  peek: Peek | null = null;
  readonly collapsed = new Set<string>();
  readonly agent: AgentPanel;
  private autoSprintPicker = true;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly imageCache = new ImageCache();
  /** The issue last shown as selected, kept when a refresh reorders the list. */
  private selectedKey: string | undefined;

  constructor(
    readonly workspace: Workspace,
    private readonly client: Pick<JiraClient, "detail" | "attachment" | "site">,
    private readonly opener: Opener,
    private readonly redraw: () => void,
    agentBackend?: AgentBackend,
  ) {
    this.agent = new AgentPanel(workspace, agentBackend, redraw, () => this.update());
    workspace.subscribe(() => this.update());
  }

  get site(): string {
    return this.client.site;
  }

  dispose(): void {
    this.agent.dispose();
    clearTimeout(this.noticeTimer);
  }

  agentActive(): boolean {
    return this.agent.active(this.layer().kind === "list");
  }

  groups(): Group[] {
    const { issues, query } = this.workspace;
    return groupIssues(issues, query.view, this.grouping, this.search);
  }

  /** Issues the selection can reach: folded groups are skipped. */
  visible(): Issue[] {
    return this.groups().flatMap(([label, issues]) => (this.collapsed.has(label) ? [] : issues));
  }

  /** Whether the peek panel fits beside the list; narrow panes open details instead. */
  peekFits(): boolean {
    return this.width - sidebarWidth(this.width) >= PEEK_MIN_WIDTH;
  }

  selected(): Issue | undefined {
    const issues = this.visible();
    this.index = Math.max(0, Math.min(this.index, issues.length - 1));
    const issue = issues[this.index];
    this.selectedKey = issue?.key;
    return issue;
  }

  private update(): void {
    if (this.selectedKey) {
      const index = this.visible().findIndex((issue) => issue.key === this.selectedKey);
      if (index >= 0) this.index = index;
    }
    if (this.picker) {
      this.picker.choices = PICKERS[this.picker.kind].items(this);
      if (!this.picker.query) this.picker.focusCurrent();
    }
    this.syncPeek();
    const { sprints, query } = this.workspace;
    if (
      this.autoSprintPicker &&
      sprints.length &&
      query.view === View.Sprint &&
      query.sprint === null &&
      !this.picker &&
      !this.agent.tab
    ) {
      this.openPicker("sprint");
      this.autoSprintPicker = false;
    }
    this.redraw();
  }

  openPicker(requested: PickerKind): void {
    // A sprint belongs to a board, so without one the board comes first.
    const kind = requested === "sprint" && !this.workspace.board ? "board" : requested;
    const source = PICKERS[kind];
    this.picker = new Picker(kind, source.title, source.items(this), source.options?.(this));
    source.load?.(this);
  }

  /** Close the picker and do what the chosen item does, which may open the next one. */
  private pick(item: PickerItem): void {
    this.picker = null;
    item.run();
  }

  changeQuery(change: Partial<IssueQuery>): void {
    this.resetList();
    this.workspace.change(scoped(this.workspace.query, change));
  }

  chooseBoard(board: string): void {
    this.resetList();
    this.workspace.chooseBoard(board);
    this.openPicker("sprint");
  }

  chooseAssignee(assignee: string, label: string): void {
    this.resetList();
    this.personLabel = label;
    this.workspace.change(withAssignee(this.workspace.query, assignee));
  }

  /** Images preview over the details panel; other files open in Helium. */
  openAttachment(item: Attachment): void {
    const images = (this.modal?.attachments ?? []).filter(isImage);
    if (isImage(item)) this.openPreview(previewOf(images, item));
    else this.openUrl(this.attachmentUrl(item), "Opened attachment");
  }

  /** A header, footer or peek button, or its key. */
  runAction(action: Action): void {
    switch (action) {
      case "filter":
      case "display":
      case "board":
      case "sprint":
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
        const issue = this.selected();
        if (!issue) return;
        if (this.peekFits()) this.peekOpen = !this.peekOpen;
        else this.openDetail(issue);
        return;
      }
      case "details": {
        const issue = this.selected();
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

  private removeFilter(chip: FilterChip): void {
    const { query } = this.workspace;
    if (chip === "project") this.workspace.change(scoped(query, { project: "" }));
    else if (chip === "status") this.workspace.change(scoped(query, { status: "all" }));
    else {
      this.personLabel = "All people";
      this.workspace.change(withAssignee(query, ""));
    }
    this.toTop();
  }

  clearFilters(): void {
    for (const [chip] of filterChips(this)) this.removeFilter(chip);
    this.search = "";
  }

  setGrouping(grouping: Grouping): void {
    this.grouping = grouping;
    this.collapsed.clear();
    this.toTop();
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
    const issue = this.peekOpen && this.peekFits() ? this.selected() : undefined;
    if (!issue) {
      this.peek = null;
      return;
    }
    if (this.peek?.issue.key === issue.key) {
      this.peek.issue = issue;
      return;
    }
    const peek: Peek = { issue, detail: null, error: "", scroll: 0 };
    this.peek = peek;
    this.client
      .detail(issue.key)
      .then(
        (detail) => {
          peek.detail = detail;
        },
        (error: unknown) => {
          peek.error = message(error);
        },
      )
      .finally(() => {
        if (this.peek === peek) this.redraw();
      });
  }

  openDetail(issue: Issue): void {
    this.modal = issuePanel(issue);
    this.loadDetail(this.modal);
  }

  private loadDetail(target: Panel): void {
    if (!target.issue || target.loading) return;
    target.error = "";
    target.loading = true;
    this.client
      .detail(target.issue.key)
      .then(
        (detail) => showDetail(target, detail),
        (error: unknown) => {
          target.error = message(error);
        },
      )
      .finally(() => {
        target.loading = false;
        if (this.modal === target) this.redraw();
      });
  }

  private attachmentUrl(item: Attachment): string {
    return `https://${this.site}/secure/attachment/${encodeURIComponent(item.id)}/${encodeURIComponent(item.filename)}`;
  }

  private openPreview(preview: Preview): void {
    this.preview = preview;
    this.loadImage(preview);
  }

  private stepImage(preview: Preview, delta: number): void {
    const count = preview.images.length;
    preview.index = (preview.index + delta + count) % count;
    preview.bytes = null;
    preview.error = "";
    this.loadImage(preview);
  }

  /** Download the current image; a late download for another image is dropped. */
  private loadImage(preview: Preview): void {
    const item = currentImage(preview);
    if (!item) return;
    const cached = this.imageCache.get(item.id);
    if (cached) {
      preview.bytes = cached;
      return;
    }
    const showing = () => this.preview === preview && currentImage(preview) === item;
    preview.loading = true;
    this.client
      .attachment(item.id)
      .then(
        (bytes) => {
          this.imageCache.set(item.id, bytes);
          if (showing()) preview.bytes = bytes;
        },
        (error: unknown) => {
          if (showing()) preview.error = message(error);
        },
      )
      .finally(() => {
        if (!showing()) return;
        preview.loading = false;
        this.redraw();
      });
  }

  /** Open the shown issue in Helium, or copy its link. */
  openIssue(copy: boolean): void {
    const issue = this.modal ? this.modal.issue : this.selected();
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
    if (this.preview) return { kind: "preview", preview: this.preview };
    if (this.picker) return { kind: "picker", picker: this.picker };
    if (this.modal) return { kind: "modal", panel: this.modal };
    if (this.finding !== null) return { kind: "find", draft: this.finding };
    if (this.searching) return { kind: "filter" };
    return { kind: "list" };
  }

  searchBox(): SearchBox | null {
    if (this.finding !== null) return { kind: "jira", text: this.finding, editing: true };
    if (this.searching || this.search) return { kind: "filter", text: this.search, editing: this.searching };
    if (this.workspace.query.view === View.Search)
      return { kind: "jira", text: this.workspace.query.text, editing: false };
    return null;
  }

  /** Back to the plain list, dropping any open picker, panel or prompt. */
  private closeLayers(): void {
    this.preview = null;
    this.picker = null;
    this.modal = null;
    this.finding = null;
    this.searching = false;
  }

  resetList(): void {
    this.search = "";
    this.toTop();
  }

  private toTop(): void {
    this.index = 0;
    this.offset = 0;
  }

  showView(view: View): void {
    this.agent.tab = false;
    this.collapsed.clear();
    const work = this.workspace;
    work.change(withView(work.query, view));
    this.resetList();
    if (view === View.Sprint && work.query.sprint === null) this.openPicker("sprint");
    if (view === View.Search && !work.query.text) this.finding = "";
  }

  /** Esc on search results: clear them and type a new search, staying on the tab. */
  private clearSearch(): void {
    this.workspace.change(scoped(this.workspace.query, { text: "" }));
    this.resetList();
    this.finding = "";
  }

  private cycleStatus(): void {
    const { query } = this.workspace;
    const status = STATUSES[(STATUSES.indexOf(query.status) + 1) % STATUSES.length] ?? "all";
    this.workspace.change(scoped(query, { status }));
    this.toTop();
  }

  /** Route a key to the active layer; returns false to quit. */
  handle(key: Key): boolean {
    const id = keyId(key);
    if (id === "commands") {
      this.closeLayers();
      this.agent.tab = false;
      this.runAction("commands");
      return true;
    }
    if (this.agentActive()) {
      // Issues Agent mentioned open from a dialog; the rest is Agent's own.
      if (id === "agent-cited") this.openPicker("cited");
      else this.agent.key(key, Math.max(1, this.height - 12));
      return true;
    }
    const layer = this.layer();
    switch (layer.kind) {
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
        this.selected();
    }
    this.syncPeek();
    return true;
  }

  private handlePicker(picker: Picker, key: Key): void {
    const picked = picker.handle(key, pickerRows(this.height));
    if (picked) this.pick(picked);
    else if (picker.closed) this.closePicker();
  }

  private closePicker(): void {
    this.picker = null;
    this.autoSprintPicker = false;
  }

  private handleSearch(key: Key): void {
    const edited = editLine(this.search, key, 200);
    if (edited !== undefined) this.search = edited;
    else if (keyId(key) === "enter" || keyId(key) === "escape") this.searching = false;
    else if (keyId(key) === "ctrl-c") {
      this.searching = false;
      this.search = "";
    }
    this.toTop();
  }

  private handleFind(draft: string, key: Key): void {
    const edited = editLine(draft, key, 200);
    if (edited !== undefined) {
      this.finding = edited;
    } else if (keyId(key) === "enter" && draft.trim()) {
      this.finding = null;
      this.workspace.change(scoped(this.workspace.query, { view: View.Search, text: draft.trim() }));
      this.resetList();
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
        if (this.collapsed.has(target.label)) this.collapsed.delete(target.label);
        else this.collapsed.add(target.label);
        this.selected();
        return;
      case "agent":
        this.agentClick(target.action);
        return;
      case "agent-cite": {
        const issue = this.agent.chat.current.issues.get(target.key);
        if (!issue) return;
        this.preview = null;
        this.picker = null;
        this.openDetail(issue);
        return;
      }
      case "view":
        this.closeLayers();
        this.showView(target.view);
        return;
      case "issue": {
        // The first click selects; a click on the selected issue opens it.
        const issues = this.visible();
        const index = issues.findIndex((issue) => issue.key === target.key);
        const issue = issues[index];
        if (!issue) return;
        if (index === this.index) this.openDetail(issue);
        this.index = index;
        this.selected();
        return;
      }
      case "box":
        if (this.searchBox()?.kind === "jira") this.finding ??= this.workspace.query.text;
        else this.searching = true;
        return;
      case "choice": {
        const picker = this.picker;
        const picked = picker?.visible()[target.index];
        if (!picker || !picked) return;
        if (picker.index === target.index) this.pick(picked);
        else picker.index = target.index;
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
      case "board":
      case "sprint":
        this.openPicker(action);
        return;
    }
  }

  private scrollPeek(delta: number): void {
    if (this.peek) this.peek.scroll = Math.max(0, this.peek.scroll + delta * WHEEL_LINES);
  }

  /** The mouse wheel: `delta` is +1 per notch down, -1 per notch up.
   * `over` is what the pointer is on, so the peek scrolls itself. */
  wheel(delta: number, over?: Target): void {
    const layer = this.layer();
    if (over?.kind === "peek" && this.peek && layer.kind === "list") {
      this.scrollPeek(delta);
    } else if (this.agentActive()) {
      this.agent.wheel(delta);
    } else if (layer.kind === "picker") {
      layer.picker.index = Math.max(0, layer.picker.index + delta);
    } else if (layer.kind === "modal") {
      layer.panel.scroll = Math.max(0, layer.panel.scroll + delta * WHEEL_LINES);
    } else if (layer.kind !== "preview") {
      this.index = Math.max(0, this.index + delta);
      this.selected();
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
    i: (panel) => {
      if (panel.attachments.length) this.openPicker("attachment");
    },
    r: (panel) => this.loadDetail(panel),
  });

  private readonly previewKeys = bindings<(preview: Preview) => void>({
    "q escape ctrl-c": () => {
      this.preview = null;
    },
    "right l j down pagedown": (preview) => this.stepImage(preview, 1),
    "left h k up pageup": (preview) => this.stepImage(preview, -1),
    o: (preview) => {
      const item = currentImage(preview);
      if (item) this.openUrl(this.attachmentUrl(item), "Opened in Helium");
    },
  });

  private readonly listKeys = bindings<() => void>({
    // Esc steps back: first the peek, then the filter, then the Jira search.
    escape: () => {
      if (this.peekOpen) this.peekOpen = false;
      else if (!this.search && this.workspace.query.text && this.workspace.query.view === View.Search)
        this.clearSearch();
      else this.resetList();
    },
    "/": () => {
      this.searching = true;
    },
    F: () => this.runAction("filter"),
    D: () => this.runAction("display"),
    z: () => {
      const issue = this.selected();
      const group = this.groups().find(([, issues]) => issue && issues.includes(issue));
      if (group) this.collapsed.add(group[0]);
    },
    Z: () => this.collapsed.clear(),
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
    "j down": () => {
      this.index += 1;
    },
    "k up": () => {
      this.index -= 1;
    },
    pagedown: () => {
      this.index += Math.max(1, listRows(this.height, this.searchBox() !== null) - 1);
    },
    pageup: () => {
      this.index -= Math.max(1, listRows(this.height, this.searchBox() !== null) - 1);
    },
    home: () => {
      this.index = 0;
    },
    end: () => {
      this.index = this.visible().length - 1;
    },
    "enter v": () => this.runAction("details"),
    "?": () => this.runAction("help"),
    t: () => this.runAction("brief"),
    r: () => this.runAction("refresh"),
    o: () => this.openIssue(false),
    y: () => this.openIssue(true),
    b: () => this.openPicker("board"),
    s: () => this.openPicker("sprint"),
    p: () => this.openPicker("project"),
    a: () => this.openPicker("assignee"),
    d: () => this.cycleStatus(),
    g: () => this.setGrouping(this.grouping === "status" ? "assignee" : "status"),
    n: () => this.runAction("load-more"),
  });
}
