import { describe, expect, mock, test } from "bun:test";
import type { Snapshot } from "../jira/client";
import { plainText, toDoc } from "../jira/adf";
import { toComments } from "../jira/parse";
import { initialQuery, View } from "../jira/query";
import type { Detail } from "../jira/types";
import { Workspace } from "../state/workspace";
import { deferred, rawComment, settle, snapshot } from "../testing";
import { Dashboard } from "./dashboard";
import type { Key } from "./input";
import { detailBlocks } from "./panel";
import { frame } from "./frame";
import { pickerRows } from "./layout";
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
  dashboard.height = 40;
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

  test("an empty Search view asks for words", () => {
    const { dashboard } = setup();
    dashboard.handle({ text: "7" });
    expect(dashboard.finding).toBe("");
  });

  test("clicks select, then open; the wheel moves and scrolls", () => {
    const { dashboard, client } = setup();
    dashboard.click({ kind: "issue", key: "EX-2" });
    expect(dashboard.selected()?.key).toBe("EX-2");
    expect(dashboard.modal).toBeNull();
    dashboard.click({ kind: "issue", key: "EX-2" });
    expect(client.detail).toHaveBeenCalledWith("EX-2");
    dashboard.wheel(1);
    expect(dashboard.modal?.scroll).toBe(3);
    dashboard.handle(ESC);
    dashboard.wheel(-1);
    expect(dashboard.selected()?.key).toBe("EX-1");
    dashboard.click({ kind: "view", view: View.Mine });
    expect(dashboard.workspace.query.view).toBe(View.Mine);
  });

  test("clicking a picker choice highlights it; a second click chooses it", () => {
    const { dashboard, work } = setup();
    work.projects = [{ value: "EX", label: "Example", detail: "", state: "" }];
    dashboard.handle({ text: "p" });
    dashboard.click({ kind: "choice", index: 1 });
    expect(dashboard.picker?.index).toBe(1);
    dashboard.click({ kind: "choice", index: 1 });
    expect(work.query.project).toBe("EX");
  });

  test("typing a search never triggers navigation", () => {
    const { dashboard, source } = setup();
    dashboard.handle({ text: "/" });
    for (const key of text("q2dn")) expect(dashboard.handle(key)).toBe(true);
    expect(dashboard.search).toBe("q2dn");
    expect(source.snapshot).not.toHaveBeenCalled();
  });

  test("opening another issue while details load shows that issue", async () => {
    const { dashboard, pending } = setup();
    dashboard.handle(ENTER);
    dashboard.handle(ESC);
    dashboard.handle({ text: "j" });
    dashboard.handle(ENTER);
    expect(dashboard.modal?.issue?.key).toBe("EX-2");
    pending[0]?.resolve(detail("EX-1 description"));
    await settle();
    expect(dashboard.modal?.body).toEqual([]);
    pending[1]?.resolve(detail("EX-2 description"));
    await settle();
    expect(plainText(dashboard.modal?.body ?? [])).toContain("EX-2 description");
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
    expect(dashboard.modal?.title).toBe("Sprint 7");
    expect(plainText(dashboard.modal?.body ?? [])).toContain("Ship statuses");
  });

  test("the attachment picker opens other files in Helium and returns to details", async () => {
    const { dashboard, pending, opener } = setup();
    dashboard.handle(ENTER);
    pending[0]?.resolve(
      detail("", { attachments: [file("42", "flow chart.pdf", "application/pdf")] }),
    );
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
    dashboard.handle(ENTER);
    pending[0]?.resolve(
      detail("", {
        attachments: [file("1", "a.png", "image/png"), file("2", "notes.pdf", "application/pdf"), file("3", "b.jpg", "image/jpeg")],
      }),
    );
    await settle();
    dashboard.handle({ text: "i" });
    dashboard.handle(ENTER);
    expect(dashboard.preview?.images.map((i) => i.filename)).toEqual(["a.png", "b.jpg"]);
    downloads[0]?.reply.resolve(new Uint8Array([1]));
    await settle();
    expect(dashboard.preview?.bytes).toEqual(new Uint8Array([1]));

    dashboard.handle({ name: "right" });
    expect(downloads[1]?.id).toBe("3");
    expect(dashboard.preview?.bytes).toBeNull();
    dashboard.handle({ name: "left" });
    expect(dashboard.preview?.bytes).toEqual(new Uint8Array([1])); // from the cache
    downloads[1]?.reply.resolve(new Uint8Array([3])); // late; another image is showing
    await settle();
    expect(dashboard.preview?.bytes).toEqual(new Uint8Array([1]));

    expect(frame(dashboard, 80, 24).text(7)).toContain("1 of 2");
    dashboard.handle(ESC);
    expect(dashboard.preview).toBeNull();
    expect(dashboard.modal?.attachments.length).toBe(3);
  });

  test("a refresh keeps the selected issue when the order changes", async () => {
    const { dashboard, work, source } = setup();
    dashboard.index = 1;
    dashboard.selected();
    source.snapshot.mockImplementation(() => Promise.resolve(snapshot(work.query, ["EX-2", "EX-1"])));
    work.refresh();
    await settle();
    expect(dashboard.selected()?.key).toBe("EX-2");
    expect(dashboard.index).toBe(0);
  });

  test("details headings count comments that mention me", () => {
    const comments = toComments([rawComment("Please check ", "2026-11-05T13:08:14.000+0300", "me")], "me");
    const blocks = detailBlocks(detail("Spec", { comments }));
    const text = plainText(blocks);
    expect(text).toContain("Comments · 1 · 1 mention you · newest first");
    expect(text).toContain("● Charlie · 2026-11-05 13:08 · mentions you");
    expect(blocks).toContainEqual(expect.objectContaining({ keep: true, spans: [expect.objectContaining({ style: "mention" })] }));
  });
});

describe("picker", () => {
  test("Tab separates active, planned and closed sprints", () => {
    const picker = new Picker(
      "sprint",
      "Choose sprint",
      [
        { value: "1", label: "Current", detail: "", state: "active" },
        { value: "2", label: "Next", detail: "", state: "future" },
        { value: "3", label: "Previous", detail: "", state: "closed" },
      ],
      ["active", "future", "closed", "all"],
    );
    expect(picker.visible()[0]?.value).toBe("1");
    picker.handle({ name: "tab" }, 5);
    expect(picker.visible()[0]?.value).toBe("2");
    picker.handle({ name: "tab" }, 5);
    expect(picker.handle(ENTER, 5)?.value).toBe("3");
  });

  test("the sprint picker opens on the first tab that has sprints", () => {
    const { dashboard, work } = setup();
    work.board = "13";
    work.sprints = [{ id: 1, name: "Old", state: "closed", start: "", end: "", goal: "" }];
    dashboard.openPicker("sprint");
    expect(dashboard.picker?.tabName).toBe("closed");
    expect(dashboard.picker?.visible().map((c) => c.label)).toEqual(["Old"]);
  });

  test("page keys move exactly one visible page", () => {
    const choices = Array.from({ length: 100 }, (_, n) => ({ value: `${n}`, label: `Board ${n}`, detail: "", state: "" }));
    const picker = new Picker("board", "Choose board", choices);
    picker.handle({ name: "pagedown" }, pickerRows(40));
    expect(picker.index).toBe(pickerRows(40));
  });
});

describe("frame", () => {
  test("rows fit the terminal and the selection is marked", () => {
    const { dashboard } = setup();
    const canvas = frame(dashboard, 80, 24);
    for (let y = 0; y < 24; y++) expect(canvas.text(y).length).toBeLessThanOrEqual(80);
    expect(canvas.text(7)).toContain("› EX-1");
    expect(canvas.text(1)).toContain("2 All");
  });

  test("a small pane asks to be resized", () => {
    const { dashboard } = setup();
    expect(frame(dashboard, 50, 10).text(1)).toContain("at least 60 × 18");
  });
});
