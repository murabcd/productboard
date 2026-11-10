import { describe, expect, mock, test } from "bun:test";
import type { AgentBackend } from "../agent/chat";
import { plainText, toDoc } from "../jira/adf";
import type { Snapshot } from "../jira/client";
import { toComments } from "../jira/parse";
import { initialQuery, View } from "../jira/query";
import type { Detail } from "../jira/types";
import { Workspace } from "../state/workspace";
import { deferred, fakeAgent, rawComment, settle, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import { frame } from "./frame";
import type { Key } from "./input";
import { pickerRows } from "./layout";
import { NAVIGATION, navKey } from "./navigation";
import { detailBlocks } from "./panel";
import { Picker } from "./picker";

const text = (value: string): Key[] => [...value].map((ch) => ({ text: ch }));
const ENTER: Key = { name: "enter" };
const ESC: Key = { name: "escape" };

function detail(description: string, extra: Partial<Detail> = {}): Detail {
  return { facts: [], description: toDoc(description), comments: [], attachments: [], ...extra };
}

const file = (id: string, filename: string, mimeType: string) => ({
  id,
  filename,
  mimeType,
  size: 10,
  author: "D",
  created: "",
});

function draw(dashboard: Dashboard, width: number, height: number) {
  dashboard.resize(width, height);
  return frame(dashboard);
}

function setup() {
  const pending: ReturnType<typeof deferred<Detail>>[] = [];
  const downloads: { id: string; reply: ReturnType<typeof deferred<Uint8Array>> }[] = [];
  const client = {
    site: "example.atlassian.net",
    detail: mock(() => {
      const reply = deferred<Detail>();
      pending.push(reply);
      return reply.promise;
    }),
    attachment: mock((id: string) => {
      const reply = deferred<Uint8Array>();
      downloads.push({ id, reply });
      return reply.promise;
    }),
  };
  const opener = { open: mock(async () => {}), copy: mock(async () => {}) };
  const source = {
    snapshot: mock((): Promise<Snapshot> => deferred<Snapshot>().promise),
    catalog: mock(() => deferred<never>().promise),
    sprints: mock(() => deferred<never>().promise),
  };
  const work = new Workspace(source);
  work.query = { ...initialQuery, view: View.All };
  work.snapshot = snapshot(work.query, ["EX-1", "EX-2"]);
  const dashboard = new Dashboard(work, client, opener, () => {});
  dashboard.resize(120, 40);
  return { dashboard, work, client, opener, pending, downloads, source };
}

describe("dashboard", () => {
  test("f searches all of Jira in the Search view; Esc cancels", () => {
    const { dashboard, work } = setup();
    for (const key of text("fq")) dashboard.handle(key);
    expect(work.query.view).toBe(View.All); // q was typed, not quit
    dashboard.handle({ name: "escape" });
    expect(dashboard.finding).toBeNull();
    for (const key of [...text("fоплата"), ENTER]) dashboard.handle(key);
    expect(work.query).toMatchObject({ view: View.Search, text: "оплата" });
    expect(dashboard.finding).toBeNull();
    dashboard.handle({ text: "f" });
    expect(dashboard.finding).toBe("оплата"); // edits the last search
  });

  test("searches type into a box above the list, like a picker", () => {
    const { dashboard } = setup();
    for (const key of text("fоплата")) dashboard.handle(key);
    let canvas = draw(dashboard, 80, 24);
    expect(canvas.text(5)).toContain("Search Jira  / оплата▏");
    expect(canvas.text(24 - 1)).not.toContain("Shortcuts"); // typing a search hides the key hints
    dashboard.handle(ESC);
    dashboard.handle({ text: "/" });
    canvas = draw(dashboard, 80, 24);
    expect(canvas.text(5)).toContain("Filter loaded  / ▏");
    expect(canvas.text(8)).toContain("To do 2 ▾"); // the list starts below the box
    dashboard.handle(ENTER);
    expect(dashboard.searching).toBe(false);
    dashboard.click({ kind: "box" });
    expect(dashboard.searching).toBe(true);
  });

  test("Esc clears a search and stays on the Search tab", () => {
    const { dashboard, work } = setup();
    for (const key of [...text("fоплата"), ENTER]) dashboard.handle(key);
    expect(work.query).toMatchObject({ view: View.Search, text: "оплата" });
    for (const key of [...text("/x"), ENTER]) dashboard.handle(key);
    dashboard.handle(ESC); // clears the filter first
    expect(dashboard.list.search).toBe("");
    expect(work.query.text).toBe("оплата");
    dashboard.handle(ESC); // then the search, ready for a new one
    expect(work.query).toMatchObject({ view: View.Search, text: "" });
    expect(dashboard.finding).toBe("");
    dashboard.handle(ESC); // stop typing; still on the tab
    expect(dashboard.finding).toBeNull();
    expect(work.query.view).toBe(View.Search);
  });

  test("an empty Search view asks for words", () => {
    const { dashboard } = setup();
    dashboard.handle({ text: "1" });
    expect(dashboard.finding).toBe("");
  });

  test("clicks select, then open; the wheel moves and scrolls", () => {
    const { dashboard, client } = setup();
    dashboard.click({ kind: "issue", key: "EX-2" });
    expect(dashboard.list.selected?.key).toBe("EX-2");
    expect(dashboard.modal).toBeNull();
    dashboard.click({ kind: "issue", key: "EX-2" });
    expect(client.detail).toHaveBeenCalledWith("EX-2");
    dashboard.wheel(1);
    expect(dashboard.modal?.scroll).toBe(3);
    dashboard.handle(ESC);
    dashboard.wheel(-1);
    expect(dashboard.list.selected?.key).toBe("EX-1");
    dashboard.click({ kind: "view", view: View.Mine });
    expect(dashboard.workspace.query.view).toBe(View.Mine);
  });

  test("clicking a picker choice highlights it; a second click chooses it", () => {
    const { dashboard, work } = setup();
    work.projects = [{ value: "EX", label: "Example", detail: "", state: "" }];
    dashboard.handle({ text: "p" });
    dashboard.click({ kind: "choice", value: "EX" });
    expect(dashboard.picker?.selected?.value).toBe("EX");
    dashboard.click({ kind: "choice", value: "EX" });
    expect(work.query.project).toBe("EX");
  });

  test("typing a search never triggers navigation", () => {
    const { dashboard, source } = setup();
    dashboard.handle({ text: "/" });
    for (const key of text("q2dn")) expect(dashboard.handle(key)).toBe(true);
    expect(dashboard.list.search).toBe("q2dn");
    expect(source.snapshot).not.toHaveBeenCalled();
  });

  test("opening another issue while details load shows that issue", async () => {
    const { dashboard, pending } = setup();
    dashboard.handle(ENTER);
    dashboard.handle(ESC);
    dashboard.handle({ text: "j" });
    dashboard.handle(ENTER);
    expect(dashboard.modal).toMatchObject({ kind: "issue", issue: { key: "EX-2" } });
    pending[0]?.resolve(detail("EX-1 description"));
    await settle();
    expect(dashboard.modal).toMatchObject({ read: { state: { kind: "loading", data: null } } });
    pending[1]?.resolve(detail("EX-2 description"));
    await settle();
    expect(draw(dashboard, 120, 30).text(8)).toContain("EX-2 description");
  });

  test("a closed issue's late details cannot replace a sprint goal", async () => {
    const { dashboard, work, pending } = setup();
    work.sprints = [{ id: 7, name: "Sprint 7", state: "active", start: "", end: "", goal: "Ship statuses" }];
    work.query = { ...work.query, sprint: 7 };
    dashboard.handle(ENTER);
    dashboard.handle(ESC);
    dashboard.handle({ text: "t" });
    pending[0]?.resolve(detail("An issue's description"));
    await settle();
    expect(dashboard.modal).toMatchObject({ kind: "text", title: "Sprint 7" });
    expect(draw(dashboard, 120, 30).text(10)).toContain("Ship statuses");
  });

  test("the attachment picker opens other files in Helium and returns to details", async () => {
    const { dashboard, pending, opener } = setup();
    dashboard.handle(ENTER);
    pending[0]?.resolve(detail("", { attachments: [file("42", "flow chart.pdf", "application/pdf")] }));
    await settle();
    dashboard.handle({ text: "i" });
    expect(dashboard.picker?.kind).toBe("attachment");
    dashboard.handle(ENTER);
    expect(opener.open).toHaveBeenCalledWith("https://example.atlassian.net/secure/attachment/42/flow%20chart.pdf");
    expect(dashboard.picker).toBeNull();
    expect(dashboard.modal).not.toBeNull();
  });

  test("images preview in the terminal; arrows flip, Esc returns to details", async () => {
    const { dashboard, pending, downloads } = setup();
    dashboard.handle({ text: " " });
    dashboard.handle(ENTER);
    pending[0]?.resolve(
      detail("", {
        attachments: [
          file("1", "a.png", "image/png"),
          file("2", "notes.pdf", "application/pdf"),
          file("3", "b.jpg", "image/jpeg"),
        ],
      }),
    );
    await settle();
    dashboard.handle({ text: "i" });
    expect(dashboard.picker?.kind).toBe("attachment");
    const heading = draw(dashboard, 120, 40).text(5);
    expect(heading).toContain("Issue details");
    expect(heading).not.toContain("Issue peek");
    dashboard.handle(ESC);
    expect(dashboard.picker).toBeNull();
    expect(frame(dashboard).text(5)).toContain("Issue details");
    dashboard.handle({ text: "i" });
    dashboard.handle(ENTER);
    expect(dashboard.preview?.images.map((i) => i.filename)).toEqual(["a.png", "b.jpg"]);
    downloads[0]?.reply.resolve(new Uint8Array([1]));
    await settle();
    expect(dashboard.preview?.read.state).toEqual({ kind: "ready", bytes: new Uint8Array([1]) });

    dashboard.handle({ name: "right" });
    expect(downloads[1]?.id).toBe("3");
    expect(dashboard.preview?.read.state).toEqual({ kind: "loading" });
    dashboard.handle({ name: "left" });
    expect(dashboard.preview?.read.state).toEqual({ kind: "ready", bytes: new Uint8Array([1]) }); // from the cache
    dashboard.handle({ name: "right" });
    expect(downloads).toHaveLength(2);
    dashboard.handle({ name: "left" });
    downloads[1]?.reply.resolve(new Uint8Array([3])); // late; another image is showing
    await settle();
    expect(dashboard.preview?.read.state).toEqual({ kind: "ready", bytes: new Uint8Array([1]) });

    expect(draw(dashboard, 80, 24).text(6)).toContain("1 of 2");
    dashboard.handle(ESC);
    expect(dashboard.preview).toBeNull();
    expect(dashboard.attachments.length).toBe(3);
    expect(frame(dashboard).text(5)).toContain("Issue details");
  });

  test("Page Down counts group headings and skips folded issues", () => {
    const { dashboard, work } = setup();
    const base = snapshot(
      work.query,
      Array.from({ length: 14 }, (_, i) => `EX-${i + 1}`),
    );
    work.snapshot = {
      ...base,
      issues: base.issues.map((issue, i) => ({ ...issue, assignee: `Person ${String(i + 1).padStart(2, "0")}` })),
    };
    dashboard.resize(120, 18);
    dashboard.handle({ text: "g" });
    dashboard.click({ kind: "group", label: "Person 02" });
    expect(dashboard.list.selected?.key).toBe("EX-1");
    dashboard.handle({ name: "pagedown" });
    expect(dashboard.list.selected?.key).toBe("EX-6");
    expect(frame(dashboard).text(7)).toContain("EX-6");
    dashboard.handle({ name: "pageup" });
    expect(dashboard.list.selected?.key).toBe("EX-1");
  });

  test("a refresh keeps the selected issue when the order changes", async () => {
    const { dashboard, work, source } = setup();
    dashboard.handle({ name: "down" });
    source.snapshot.mockImplementation(() => Promise.resolve(snapshot(work.query, ["EX-2", "EX-1"])));
    work.refresh();
    await settle();
    expect(dashboard.list.selected?.key).toBe("EX-2");
    dashboard.handle({ name: "down" });
    expect(dashboard.list.selected?.key).toBe("EX-1");
  });

  test("details headings count comments that mention me", () => {
    const comments = toComments([rawComment("Please check ", "2026-11-05T13:08:14.000+0300", "me")], "me");
    const blocks = detailBlocks(detail("Spec", { comments }));
    const text = plainText(blocks);
    expect(text).toContain("Comments · 1 · 1 mention you · newest first");
    expect(text).toContain("● Charlie · 11/05/2026 1:08 PM · mentions you");
    expect(blocks).toContainEqual(
      expect.objectContaining({ keep: true, spans: [expect.objectContaining({ style: "mention" })] }),
    );
  });
});

describe("picker", () => {
  test("Tab separates active, planned and closed sprints", () => {
    const picker = new Picker(
      "sprint",
      "Choose sprint",
      [
        { value: "1", label: "Current", detail: "", state: "active", run: () => {} },
        { value: "2", label: "Next", detail: "", state: "future", run: () => {} },
        { value: "3", label: "Previous", detail: "", state: "closed", run: () => {} },
      ],
      { tabs: ["active", "future", "closed", "all"] },
    );
    expect(picker.selected?.value).toBe("1");
    picker.handle({ name: "tab" }, 5);
    expect(picker.selected?.value).toBe("2");
    picker.handle({ name: "tab" }, 5);
    expect(picker.handle(ENTER, 5)).toMatchObject({ value: "3" });
  });

  test("the sprint picker opens on the first tab that has sprints", () => {
    const { dashboard, work } = setup();
    work.board = "13";
    work.sprints = [{ id: 1, name: "Old", state: "closed", start: "", end: "", goal: "" }];
    dashboard.openPicker("sprint");
    expect(dashboard.picker?.tabName).toBe("closed");
    expect(dashboard.picker?.selected?.label).toBe("Old");
  });

  test("a board refresh preserves the highlighted choice when the order changes", () => {
    const { dashboard, work } = setup();
    const first = { value: "1", label: "First", detail: "", state: "" };
    const second = { value: "2", label: "Second", detail: "", state: "" };
    work.board = first.value;
    work.boards = [first, second];
    dashboard.openPicker("board");
    dashboard.handle({ name: "down" });
    work.boards = [second, first];
    work.refresh();
    dashboard.handle(ENTER);
    expect(work.board).toBe(second.value);
  });

  test("a picker page counts group headings and separators", () => {
    const choices = Array.from({ length: 6 }, (_, i) => ({
      value: String(i),
      label: `Choice ${i}`,
      detail: "",
      group: i < 2 ? "First" : "Second",
      run: () => {},
    }));
    const picker = new Picker("commands", "Commands", choices);
    picker.handle({ name: "pagedown" }, 4);
    expect(picker.handle(ENTER, 4)).toMatchObject({ value: "2" });
    picker.move(-1);
    expect(picker.handle(ENTER, 4)).toMatchObject({ value: "1" });
  });

  test("page keys move exactly one visible page", () => {
    const choices = Array.from({ length: 100 }, (_, n) => ({
      value: `${n}`,
      label: `Board ${n}`,
      detail: "",
      run: () => {},
    }));
    const picker = new Picker("board", "Choose board", choices);
    picker.handle({ name: "pagedown" }, pickerRows(40));
    expect(picker.selected?.value).toBe(String(pickerRows(40)));
  });
});

describe("concept layout", () => {
  const withStatuses = (work: Workspace, statuses: [string, "new" | "indeterminate" | "done"][]) => {
    const base = snapshot(
      work.query,
      statuses.map((_, n) => `EX-${n + 1}`),
    );
    work.snapshot = {
      ...base,
      issues: base.issues.map((issue, n) => {
        const [status, category] = statuses[n] ?? ["", "new"];
        return { ...issue, status, category };
      }),
    };
  };

  test("status groups follow the workflow stage order", () => {
    const { dashboard, work } = setup();
    withStatuses(work, [
      ["Done", "done"],
      ["Ready for dev", "new"],
      ["Dev Blocked", "indeterminate"],
      ["IN QA", "indeterminate"],
      ["QA Blocked", "indeterminate"],
      ["In Progress", "indeterminate"],
      ["Backlog", "new"],
    ]);
    expect(dashboard.list.window(30).rows.flatMap((row) => ("label" in row ? [[row.label, row.count]] : []))).toEqual([
      ["Blocked", 2],
      ["In progress", 1],
      ["In review", 1],
      ["Done", 1],
      ["To do", 1],
      ["Backlog", 1],
    ]);
  });

  test("Space peeks at the selected issue beside the list and loads it once", async () => {
    const { dashboard, client, pending } = setup();
    dashboard.handle({ text: " " });
    expect(dashboard.peek?.issue.key).toBe("EX-1");
    expect(client.detail).toHaveBeenCalledTimes(1);
    pending[0]?.resolve(detail("EX-1 description"));
    await settle();
    expect(draw(dashboard, 120, 30).text(5)).toContain("Issue peek");
    dashboard.handle({ name: "down" });
    expect(dashboard.peek?.issue.key).toBe("EX-2");
    dashboard.handle({ name: "up" });
    expect(client.detail).toHaveBeenCalledTimes(3); // each move shows the newly selected issue
    dashboard.handle(ESC);
    expect(dashboard.peek).toBeNull();
    dashboard.resize(80, 30); // too narrow for a side panel: Space opens details
    dashboard.handle({ text: " " });
    expect(dashboard.modal).toMatchObject({ kind: "issue", issue: { key: "EX-1" } });
  });

  test("Peek and full details share one read, including a failed read and retry", async () => {
    const { dashboard, client, pending } = setup();
    dashboard.handle({ text: " " });
    dashboard.handle(ENTER);
    expect(client.detail).toHaveBeenCalledTimes(1);
    pending[0]?.reject(new Error("Jira temporarily unavailable"));
    await settle();

    expect(draw(dashboard, 120, 30).text(8)).toContain("Jira temporarily unavailable");
    dashboard.handle({ text: "r" });
    dashboard.handle({ text: "r" });
    expect(client.detail).toHaveBeenCalledTimes(2);
    pending[1]?.resolve(detail("Details after retry"));
    await settle();
    expect(draw(dashboard, 120, 30).text(8)).toContain("Details after retry");

    dashboard.handle(ESC);
    const peek = draw(dashboard, 120, 30);
    expect(Array.from({ length: 30 }, (_, row) => peek.text(row)).join("\n")).toContain("Details after retry");
    dashboard.handle(ENTER);
    expect(client.detail).toHaveBeenCalledTimes(2);

    dashboard.handle({ text: "r" });
    expect(client.detail).toHaveBeenCalledTimes(3);
    expect(draw(dashboard, 120, 30).text(8)).toContain("Details after retry");
    pending[2]?.resolve(detail("Updated details"));
    await settle();
    expect(draw(dashboard, 120, 30).text(8)).toContain("Updated details");
  });

  test("a long peek scrolls under its top bar", async () => {
    const { dashboard, pending } = setup();
    dashboard.handle({ text: " " });
    const words = Array.from({ length: 120 }, (_, n) => `word${n}`).join(" ");
    pending[0]?.resolve(detail(words));
    await settle();
    let canvas = draw(dashboard, 120, 30);
    expect(canvas.text(5)).toContain("↓ more");
    dashboard.wheel(1, { kind: "peek" });
    expect(dashboard.list.selected?.key).toBe("EX-1"); // the list stays put
    canvas = draw(dashboard, 120, 30);
    expect(canvas.text(5)).toContain("↑↓ more");
    expect(canvas.text(7).slice(82)).not.toContain("EX-1"); // the key scrolled out of the peek
  });

  test("active filters show beside Filter; Clear filters in its menu removes them", () => {
    const { dashboard, work, source } = setup();
    work.query = { ...work.query, project: "WEB", status: "open" };
    const canvas = draw(dashboard, 120, 30);
    // One toolbar: filters on the left, Display on the right; no web-style × on the labels.
    expect(canvas.text(4)).toMatch(/Filter 2 ▾ +Project: WEB +Status: Open +Display ▾/);
    expect(canvas.text(4)).not.toContain("×");
    expect(canvas.text(1)).not.toContain("Filter");
    dashboard.click({ kind: "action", action: "filter" });
    for (const key of [...text("clear"), ENTER]) dashboard.handle(key);
    expect(work.query).toMatchObject({ project: "", status: "all" });
    expect(source.snapshot).toHaveBeenCalledTimes(1);
  });

  test("a folded group hides its rows and the selection skips them", () => {
    const { dashboard, work } = setup();
    withStatuses(work, [
      ["QA Blocked", "indeterminate"],
      ["Ready for dev", "new"],
    ]);
    dashboard.click({ kind: "group", label: "Blocked" });
    expect(dashboard.list.selected?.key).toBe("EX-2");
    expect(dashboard.list.window(30).count).toBe(1);
    expect(draw(dashboard, 120, 30).text(6)).toContain("Blocked 1 ▸");
    dashboard.click({ kind: "group", label: "Blocked" });
    expect(dashboard.list.window(30).count).toBe(2);
  });

  test("number keys and Tab follow the sidebar order", () => {
    const { dashboard, work } = setup();
    const view = () => work.query.view;
    const order: [string, View][] = [
      ["1", View.Search],
      ["2", View.Mentions],
      ["3", View.Mine],
      ["5", View.Today],
      ["6", View.Sprint],
      ["7", View.All],
    ];
    for (const [key, expected] of order) {
      dashboard.handle({ text: key });
      dashboard.handle(ESC); // close the sprint picker or search prompt a view may open
      expect(view()).toBe(expected);
    }
    dashboard.handle({ text: "4" });
    expect(dashboard.agent.tab).toBe(true);
    dashboard.handle(ESC);
    dashboard.handle({ text: "1" });
    dashboard.handle(ESC); // leave the Search input
    dashboard.handle({ name: "tab" });
    expect(view()).toBe(View.Mentions);
    dashboard.handle({ name: "tab" });
    expect(view()).toBe(View.Mine);
    dashboard.handle({ name: "tab" });
    expect(view()).toBe(View.Today); // Agent is not a view; Tab skips it
  });

  test("every page shares the title bar with the app name and command shortcut", () => {
    const { dashboard, work } = setup();
    const header = (): [string, string] => {
      const canvas = draw(dashboard, 120, 30);
      return [canvas.text(0), canvas.text(1).slice(20).trim()];
    };
    for (const page of NAVIGATION) {
      if (page.to === "agent") dashboard.handle({ text: navKey(page) });
      else work.query = { ...initialQuery, view: page.to };
      const [title, description] = header();
      expect(title).toMatch(new RegExp(`^  PRODUCTBOARD +${page.name} +\\^K`));
      expect(description.length).toBeGreaterThan(0);
      dashboard.agent.tab = false;
    }
  });

  test("the Agent page shows its title once and no issue filters", () => {
    const { dashboard } = setup();
    dashboard.handle({ text: "4" });
    const canvas = draw(dashboard, 120, 30);
    const rows = Array.from({ length: 30 }, (_, y) => canvas.text(y).slice(20).trim());
    expect(rows.filter((row) => /^(✦ )?Agent\s*(\^K)?$/.test(row))).toHaveLength(1);
    expect(rows.join("\n")).not.toContain("Filter");
  });

  test("Agent talks about the board's active sprint when the page has none", async () => {
    const ask = mock(async () => {});
    const { work } = setup();
    work.query = { ...initialQuery, view: View.Mine };
    const dashboard = new Dashboard(
      work,
      { site: "x", detail: mock(), attachment: mock() },
      { open: mock(), copy: mock() },
      () => {},
      { agent: fakeAgent(ask) },
    );
    expect(dashboard.agent.scope).toBeNull();
    dashboard.agent.chat.current.draft = "Any risks?";
    dashboard.agent.send();
    expect(ask).not.toHaveBeenCalled();
    expect(dashboard.agent.chat.current.error).toBe("Choose a sprint first: Sprint ▾"); // Enter is never silent
    work.sprints = [{ id: 7, name: "Team - Sprint 7", state: "active", start: "", end: "", goal: "" }];
    expect(dashboard.agent.scope).toEqual({ sprint: 7, label: "Team - Sprint 7" });
    dashboard.agent.chat.current.draft = "Any risks?";
    dashboard.agent.send();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test("a turn shows the prompt, Markdown reply, and model", async () => {
    const ask = mock<AgentBackend["ask"]>(async ({ onText }) => onText("## Risks\n- **FL-1** is blocked"));
    const { work } = setup();
    work.query = { ...initialQuery, view: View.Sprint, sprint: 7 };
    const dashboard = new Dashboard(
      work,
      { site: "x", detail: mock(), attachment: mock() },
      { open: mock(), copy: mock() },
      () => {},
      { agent: fakeAgent(ask) },
    );
    dashboard.handle({ text: "4" });
    dashboard.agent.chat.current.draft = "Any risks?";
    dashboard.agent.send();
    await settle();
    const canvas = draw(dashboard, 120, 30);
    const screen = Array.from({ length: 30 }, (_, y) => canvas.text(y).slice(20)).join("\n");
    expect(screen).toMatch(/┃ +Any risks\?/); // full width with a bar, not a right-aligned bubble
    expect(screen).toContain("Risks");
    expect(screen).toContain("• FL-1 is blocked"); // Markdown, not "- **FL-1**"
    expect(screen).toMatch(/\n +Test Model · Medium · \d+\.\ds/); // under the reply: model, reasoning, time
    expect(screen).not.toMatch(/Agent · Test Model/);
    expect(screen).not.toContain("✦ Agent\n");
    // The footer, as on other pages: the conversation and model, then Agent's keys.
    expect(canvas.text(29)).toMatch(/Test Model · Medium .* ⇧↵ New line +\^N New chat/);
    expect(canvas.text(29)).not.toContain("message");
  });

  test("the model button lists models and switches; earlier replies keep the model that wrote them", async () => {
    const ask = mock<AgentBackend["ask"]>(async ({ onText }) => onText("Done."));
    const agent = fakeAgent(ask);
    const { work } = setup();
    work.query = { ...initialQuery, view: View.Sprint, sprint: 7 };
    const dashboard = new Dashboard(
      work,
      { site: "x", detail: mock(), attachment: mock() },
      { open: mock(), copy: mock() },
      () => {},
      { agent },
    );
    dashboard.handle({ text: "4" });
    dashboard.agent.chat.current.draft = "First?";
    dashboard.agent.send();
    await settle();
    expect(draw(dashboard, 120, 30).text(4)).toContain("Test Model · Medium ▾");
    dashboard.click({ kind: "action", action: "model" });
    expect(dashboard.picker?.kind).toBe("model");
    const dialog = () => {
      const canvas = draw(dashboard, 120, 30);
      return Array.from({ length: 30 }, (_, y) => canvas.text(y)).join("\n");
    };
    expect(dialog()).toContain("Loading models…");
    await settle();
    expect(dialog()).toMatch(/Select model +esc/);
    const lines = dialog().split("\n");
    const recent = lines.findIndex((line) => line.trim().endsWith("Recent"));
    expect(lines[recent + 1]).toMatch(/● Test Model +OpenAI/);
    expect(lines[recent + 3]?.trim().endsWith("Anthropic")).toBe(true);
    expect(lines[recent + 4]).toContain("Other Model");
    for (const key of [{ name: "down" } as const, ENTER]) dashboard.handle(key); // the cursor starts on the model in use
    await settle();
    expect(agent.choice).toEqual({ provider: "anthropic", model: "other-model", reasoning: "medium" });
    expect(dashboard.picker?.kind).toBe("reasoning");
    expect(dialog()).toMatch(/● Medium +Balanced · default/);
    for (const key of [{ name: "down" } as const, ENTER]) dashboard.handle(key);
    await settle();
    expect(agent.choice).toEqual({ provider: "anthropic", model: "other-model", reasoning: "high" });
    const canvas = draw(dashboard, 120, 30);
    expect(canvas.text(4)).toContain("Other Model · High ▾");
    expect(canvas.text(29)).toContain("Other Model · High");
    const screen = Array.from({ length: 30 }, (_, y) => canvas.text(y)).join("\n");
    expect(screen).toMatch(/Test Model · Medium · \d/); // the first reply still says which model wrote it
  });

  test("everything clickable has a key: menus, folding, tabs and the peek", async () => {
    const { dashboard, work, pending } = setup();
    withStatuses(work, [
      ["QA Blocked", "indeterminate"],
      ["Ready for dev", "new"],
    ]);
    dashboard.handle({ text: "F" });
    expect(dashboard.picker?.kind).toBe("filter");
    dashboard.handle(ESC);
    dashboard.handle({ text: "D" });
    expect(dashboard.picker?.kind).toBe("display");
    dashboard.handle(ESC);
    dashboard.handle({ text: "z" }); // folds the selected issue's group
    expect(dashboard.list.selected?.key).toBe("EX-2");
    dashboard.handle({ text: "Z" });
    expect(dashboard.list.window(30).count).toBe(2);
    dashboard.handle({ text: " " });
    pending[0]?.resolve(detail(Array.from({ length: 200 }, (_, n) => `word${n}`).join(" ")));
    await settle();
    draw(dashboard, 120, 30);
    dashboard.handle({ text: "J" });
    expect(dashboard.peek?.scroll).toBe(3);
    dashboard.handle(ESC);
    dashboard.handle({ text: "3" });
    dashboard.handle({ name: "right" });
    expect(work.query.view).toBe(View.Created);
    dashboard.handle({ name: "left" });
    expect(work.query.view).toBe(View.Mine);
  });

  test("on Agent, Ctrl-O lists the issues it mentioned and opens one", async () => {
    const ask = mock<AgentBackend["ask"]>(async ({ onIssues, onText }) => {
      onIssues(snapshot(initialQuery, ["EX-7"]).issues);
      onText("Look at EX-7.");
    });
    const { work } = setup();
    work.query = { ...initialQuery, view: View.Sprint, sprint: 7 };
    const dashboard = new Dashboard(
      work,
      { site: "x", detail: mock(() => new Promise<never>(() => {})), attachment: mock() },
      { open: mock(), copy: mock() },
      () => {},
      { agent: fakeAgent(ask) },
    );
    dashboard.handle({ text: "4" });
    dashboard.agent.chat.current.draft = "Risks?";
    dashboard.agent.send();
    await settle();
    dashboard.handle({ name: "agent-cited" });
    expect(dashboard.picker?.selected?.label).toBe("EX-7");
    dashboard.handle(ENTER);
    expect(dashboard.modal).toMatchObject({ kind: "issue", issue: { key: "EX-7" } });
  });

  test("Ctrl-K opens commands that run views and menus", () => {
    const { dashboard, work } = setup();
    dashboard.handle({ name: "commands" });
    expect(dashboard.picker?.kind).toBe("commands");
    for (const key of [...text("inbox"), ENTER]) dashboard.handle(key);
    expect(work.query.view).toBe(View.Mentions);
    dashboard.click({ kind: "action", action: "display" });
    expect(dashboard.picker?.kind).toBe("display");
    for (const key of [...text("assignee"), ENTER]) dashboard.handle(key);
    expect(dashboard.list.grouping).toBe("assignee");
  });
});

describe("frame", () => {
  test("rows fit the terminal and the selection is marked", () => {
    const { dashboard } = setup();
    const canvas = draw(dashboard, 80, 24);
    for (let y = 0; y < 24; y++) expect(canvas.text(y).length).toBeLessThanOrEqual(80);
    expect(canvas.text(7)).toMatch(/› EX-1/);
    expect(canvas.text(0)).toMatch(/PRODUCTBOARD +All issues +\^K/);
    expect(canvas.text(23)).toContain("2 issues");
  });

  test("Team focus rows show the reason, owner and sprint once", () => {
    const { dashboard, work } = setup();
    work.query = { ...initialQuery, view: View.Today };
    const base = snapshot(work.query, ["EX-1", "EX-2"]);
    const [stuck, mine] = base.issues;
    if (!stuck || !mine) throw new Error("fixture");
    work.snapshot = {
      ...base,
      issues: [
        {
          ...stuck,
          status: "IN REVIEW",
          assignee: "Cameron",
          sprint: "Platform Team - Sprint 2",
          section: "Stuck",
          reason: "7d no update",
        },
        { ...mine, status: "Ready for dev", assignee: "Avery", section: "Assigned to you", reason: "updated 3h ago" },
      ],
    };
    const canvas = draw(dashboard, 138, 24);
    const rows = [7, 9].map((y) => canvas.text(y));
    expect(canvas.text(6)).toContain("◐ Stuck 1 ▾");
    expect(rows[0]).toMatch(/› EX-1 +Рабочая задача +7d no update +Cameron +Sprint 2/);
    expect(rows[0]).not.toContain("Platform Team");
    expect(rows[1]).toMatch(/○ EX-2 +Рабочая задача +updated 3h ago/);
    expect(rows[1]).not.toContain("Avery");
  });

  test("pickers open as a dialog over the page, the current choice marked", () => {
    const { dashboard, work } = setup();
    work.board = "1";
    work.query = { ...work.query, view: View.Sprint, sprint: 36 };
    work.sprints = [
      { id: 36, name: "HR Team - Sprint 36", state: "active", start: "2026-11-03", end: "2026-11-17", goal: "" },
      { id: 35, name: "HR Team - Sprint 35", state: "active", start: "2026-10-20", end: "2026-11-02", goal: "" },
    ];
    dashboard.openPicker("sprint");
    const canvas = draw(dashboard, 100, 30);
    const screen = Array.from({ length: 30 }, (_, y) => canvas.text(y)).join("\n");
    expect(screen).toMatch(/Choose sprint +esc/);
    expect(screen).toMatch(/● HR Team - Sprint 36 +Active · Nov 3–17/);
    expect(screen).toMatch(/ HR Team - Sprint 35 +Active · Oct 20–Nov 2/);
    expect(screen).toMatch(/tab active sprints/);
    expect(dashboard.picker?.selected?.value).toBe("36");
    dashboard.click({ kind: "issue", key: "EX-1" }); // a click outside closes the dialog
    expect(dashboard.picker).toBeNull();
  });

  test("a small pane asks to be resized", () => {
    const { dashboard } = setup();
    expect(draw(dashboard, 50, 10).text(1)).toContain("at least 60 × 18");
  });
});
