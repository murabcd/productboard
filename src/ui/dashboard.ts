/** Dashboard state and keyboard interaction, independent of the terminal. */

import type { JiraClient } from "../jira/client";
import { isPersonal, STATUSES, scoped, VIEWS, View, withAssignee, withView } from "../jira/query";
import {
  type Attachment,
  type Choice,
  describeAttachment,
  type Issue,
  isImage,
  mentionNote,
  SPRINT_STATES,
  sprintChoice,
} from "../jira/types";
import { message, type Workspace } from "../state/workspace";
import { type Group, type Grouping, groupIssues } from "./grouping";
import { bindings, editLine, type Key, keyId, type Target } from "./input";
import { listRows, modalRows, pickerRows } from "./layout";
import { helpPanel, issuePanel, type Panel, showDetail, sprintPanel } from "./panel";
import { Picker, type PickerKind } from "./picker";
import { currentImage, ImageCache, type Preview, previewOf } from "./preview";

export interface Opener {
  open(url: string): Promise<void>;
  copy(text: string): Promise<void>;
}

const PICKER_TITLES: Record<PickerKind, string> = {
  board: "Choose board",
  sprint: "Choose sprint",
  project: "Choose project",
  assignee: "People in loaded issues",
  attachment: "Attachments · Enter previews images, opens other files in Helium",
};

const NOTICE_MS = 4000;
/** Lines a mouse-wheel notch scrolls in details. */
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

const choice = (value: string, label: string, detail = ""): Choice => ({ value, label, detail, state: "" });

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
  /** An image preview shown over the issue panel. */
  preview: Preview | null = null;
  /** A short confirmation or error after open/copy; it clears itself. */
  notice = "";
  height = 24;
  private autoSprintPicker = true;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly imageCache = new ImageCache();
  /** The issue last shown as selected, kept when a refresh reorders the list. */
  private selectedKey: string | undefined;

  constructor(
    readonly workspace: Workspace,
    private readonly client: Pick<JiraClient, "detail" | "attachment" | "site">,
    private readonly opener: Opener,
    /** Schedules a new frame. */
    private readonly redraw: () => void,
  ) {
    workspace.subscribe(() => this.update());
  }

  get site(): string {
    return this.client.site;
  }

  groups(): Group[] {
    const { issues, query } = this.workspace;
    return groupIssues(issues, query.view, this.grouping, this.search);
  }

  visible(): Issue[] {
    return this.groups().flatMap(([, issues]) => issues);
  }

  selected(): Issue | undefined {
    const issues = this.visible();
    this.index = Math.max(0, Math.min(this.index, issues.length - 1));
    const issue = issues[this.index];
    this.selectedKey = issue?.key;
    return issue;
  }

  /** After any change: keep the selection, refresh open pickers, redraw. */
  private update(): void {
    if (this.selectedKey) {
      const index = this.visible().findIndex((issue) => issue.key === this.selectedKey);
      if (index >= 0) this.index = index;
    }
    if (this.picker) this.picker.choices = this.choices(this.picker.kind);
    const { sprints, query } = this.workspace;
    if (
      this.autoSprintPicker &&
      sprints.length &&
      query.view === View.Sprint &&
      query.sprint === null &&
      !this.picker
    ) {
      this.openPicker("sprint");
      this.autoSprintPicker = false;
    }
    this.redraw();
  }

  choices(kind: PickerKind): Choice[] {
    const work = this.workspace;
    switch (kind) {
      case "board":
        return work.boards;
      case "sprint":
        return work.sprints.map(sprintChoice);
      case "project":
        return [choice("", "All projects"), ...work.projects];
      case "attachment":
        return (this.modal?.attachments ?? []).map((item) => choice(item.id, item.filename, describeAttachment(item)));
      case "assignee": {
        const people = new Map(work.issues.filter((i) => i.assigneeId).map((i) => [i.assigneeId, i.assignee]));
        const sorted = [...people].sort(([, a], [, b]) => a.localeCompare(b));
        return [
          choice("", "All people"),
          choice("unassigned", "Unassigned"),
          ...sorted.map(([id, name]) => choice(id, name)),
        ];
      }
    }
  }

  openPicker(requested: PickerKind): void {
    const work = this.workspace;
    const kind = requested === "sprint" && !work.board ? "board" : requested;
    const tabs = kind === "sprint" ? [...SPRINT_STATES, "all"] : [];
    // Start on the first tab that has sprints: active, then planned, then closed.
    const present = new Set(work.sprints.map((s) => s.state));
    const tab = Math.max(
      0,
      SPRINT_STATES.findIndex((state) => present.has(state)),
    );
    this.picker = new Picker(kind, PICKER_TITLES[kind], this.choices(kind), tabs, kind === "sprint" ? tab : 0);
    if (kind === "sprint" && work.sprints.length === 0 && !work.sprintsPending) work.loadSprints();
    else if ((kind === "board" || kind === "project") && work.boards.length === 0) work.loadCatalog();
  }

  choose(kind: PickerKind, picked: Choice): void {
    const work = this.workspace;
    this.picker = null;
    if (kind === "attachment") {
      // Images preview over the details panel; other files open in Helium.
      const attachments = this.modal?.attachments ?? [];
      const item = attachments.find((a) => a.id === picked.value);
      if (item && isImage(item)) this.openPreview(previewOf(attachments.filter(isImage), item));
      else if (item) this.openUrl(this.attachmentUrl(item), "Opened attachment");
      return;
    }
    this.resetList();
    if (kind === "board") {
      work.chooseBoard(picked.value);
      this.openPicker("sprint");
    } else if (kind === "sprint") {
      work.change(scoped(work.query, { view: View.Sprint, sprint: Number(picked.value) }));
    } else if (kind === "project") {
      work.change(scoped(work.query, { project: picked.value }));
    } else {
      this.personLabel = picked.label;
      work.change(withAssignee(work.query, picked.value));
    }
  }

  private openDetail(issue: Issue): void {
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

  private urlAction(copy: boolean): void {
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

  private showView(view: View): void {
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
    const layer = this.layer();
    switch (layer.kind) {
      case "preview":
        this.previewKeys.get(keyId(key))?.(layer.preview);
        break;
      case "picker":
        this.handlePicker(layer.picker, key);
        break;
      case "modal":
        this.modalKeys.get(keyId(key))?.(layer.panel);
        break;
      case "find":
        this.handleFind(layer.draft, key);
        break;
      case "filter":
        this.handleSearch(key);
        break;
      case "list":
        if (keyId(key) === "q" || keyId(key) === "ctrl-c") return false;
        this.listKeys.get(keyId(key))?.();
        this.selected();
    }
    return true;
  }

  private handlePicker(picker: Picker, key: Key): void {
    const picked = picker.handle(key, pickerRows(this.height));
    if (picked) this.choose(picker.kind, picked);
    else if (picker.closed) {
      this.picker = null;
      this.autoSprintPicker = false;
    }
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

  /** Typing a Jira search: Enter runs it in the Search view. */
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

  /** A click on something the last frame drew. */
  click(target: Target): void {
    switch (target.kind) {
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
        // Edit whichever search the box shows.
        if (this.searchBox()?.kind === "jira") this.finding ??= this.workspace.query.text;
        else this.searching = true;
        return;
      case "choice": {
        const picker = this.picker;
        const picked = picker?.visible()[target.index];
        if (!picker || !picked) return;
        if (picker.index === target.index) this.choose(picker.kind, picked);
        else picker.index = target.index;
        return;
      }
    }
  }

  /** The mouse wheel: `delta` is +1 per notch down, -1 per notch up. */
  wheel(delta: number): void {
    const layer = this.layer();
    if (layer.kind === "preview") return;
    if (layer.kind === "picker") layer.picker.index = Math.max(0, layer.picker.index + delta);
    else if (layer.kind === "modal") layer.panel.scroll = Math.max(0, layer.panel.scroll + delta * WHEEL_LINES);
    else {
      this.index = Math.max(0, this.index + delta);
      this.selected();
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
    o: () => this.urlAction(false),
    y: () => this.urlAction(true),
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
    // Esc steps back: first the filter, then the Jira search.
    escape: () => {
      if (!this.search && this.workspace.query.text && this.workspace.query.view === View.Search) this.clearSearch();
      else this.resetList();
    },
    "/": () => {
      this.searching = true;
    },
    f: () => {
      this.finding = this.workspace.query.text;
    },
    tab: () => {
      const current = VIEWS.indexOf(this.workspace.query.view);
      this.showView(VIEWS[(current + 1) % VIEWS.length] ?? View.Sprint);
    },
    ...Object.fromEntries(VIEWS.map((view, n) => [`${n + 1}`, () => this.showView(view)])),
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
    "enter v": () => {
      const issue = this.selected();
      if (issue) this.openDetail(issue);
    },
    "?": () => {
      this.modal = helpPanel();
    },
    t: () => {
      const sprint = this.workspace.sprint();
      if (sprint) this.modal = sprintPanel(sprint);
    },
    r: () => {
      this.workspace.refresh();
      this.workspace.retryCatalogs();
    },
    o: () => this.urlAction(false),
    y: () => this.urlAction(true),
    b: () => this.openPicker("board"),
    s: () => this.openPicker("sprint"),
    p: () => this.openPicker("project"),
    a: () => this.openPicker("assignee"),
    d: () => this.cycleStatus(),
    g: () => {
      this.grouping = this.grouping === "status" ? "assignee" : "status";
      this.toTop();
    },
    n: () => this.workspace.loadMore(),
  });

  /** Why a row is listed: Today's reason, or who mentioned you and when. Empty otherwise. */
  note(issue: Issue): string {
    return issue.reason ?? (issue.mention ? mentionNote(issue.mention) : "");
  }

  personScope(): string {
    const { query } = this.workspace;
    if (isPersonal(query.view)) return "me";
    return query.assignee ? this.personLabel : "All people";
  }
}
