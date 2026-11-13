import { describe, expect, test } from "bun:test";
import { period, shortDate, usDate, usDateTime, when } from "../dates";
import { rawComment, rawIssue, textDoc } from "../testing";
import { clean, clip } from "../text";
import { plainText, toDoc } from "./adf";
import { decode, RawIssue, toComments, toDetail, toIssue } from "./parse";
import { initialQuery, jql, View, withAssignee, withView } from "./query";
import { describeAttachment, sprintDates } from "./types";

describe("terminal text", () => {
  test("remote controls and bidi overrides are removed, Russian stays", () => {
    const issue = toIssue(rawIssue("EX-1", "new", { title: "\u001b]52;clipboard\u0007Привет‮" }));
    expect(issue.summary).toBe("]52;clipboardПривет");
    expect(clean("ok\nnext", true)).toBe("ok\nnext");
    expect(clean("ok\nnext")).toBe("oknext");
  });

  test("wide characters never overflow their columns", () => {
    expect(clip("你好abc", 4)).toBe("你…");
    expect(clip("Привет", 5)).toBe("Прив…");
    expect(clip("short", 10)).toBe("short");
  });
});

describe("Jira payloads", () => {
  test("malformed issues are reported, never shown as no work", () => {
    for (const payload of [
      { error: "forbidden" },
      { ...rawIssue(), fields: { ...rawIssue().fields, status: { name: "x", statusCategory: { key: "odd" } } } },
      rawIssue("EX-1", "new", { person: { displayName: "missing id" } as never }),
    ]) {
      expect(() => decode(RawIssue, payload, "issue")).toThrow("unexpected issue");
    }
  });

  test("documents keep link targets, list items and image names", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Design",
                      marks: [{ type: "link", attrs: { href: "https://example.com/d" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x", alt: "flow.png" } }] },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    };
    const text = plainText(toDoc(doc));
    expect(text).toContain("• Design (https://example.com/d)\n");
    expect(text).toContain("[image: flow.png]\nAfter");
  });

  test("details list comments newest first and flag mentions of me", () => {
    const comments = toComments(
      [
        rawComment("Older note", "2026-11-01T09:00:00.000+0300"),
        rawComment("Please check ", "2026-11-05T13:08:14.000+0300", "me-id"),
        rawComment("For someone else ", "2026-11-06T10:00:00.000+0300", "other"),
      ],
      "me-id",
    );
    const detail = toDetail(
      {
        fields: {
          description: textDoc({ type: "text", text: "Spec" }),
          project: { name: "Example" },
          attachment: [
            {
              id: "42",
              filename: "flow.png",
              size: 245760,
              author: { displayName: "Cameron" },
              created: "2026-11-05T13:08:14.000+0300",
            },
            { filename: "no id is skipped" },
          ],
        },
      },
      comments,
    );
    expect(detail.facts).toEqual(["Project: Example"]);
    expect(detail.comments.map((c) => [c.text, c.mentionsMe])).toEqual([
      ["For someone else @Avery", false],
      ["Please check @Avery", true],
      ["Older note", false],
    ]);
    expect(detail.comments[1]?.created).toBe("2026-11-05 13:08");
    expect(detail.attachments.map(describeAttachment)).toEqual(["240 KB · Cameron · 11/05/2026"]);
  });
});

describe("scopes", () => {
  test("Created uses Jira's creator, not reporter or assignee", () => {
    const query = jql({ ...initialQuery, view: View.Created });
    expect(query).toContain("creator = currentUser()");
    expect(query).not.toContain("reporter");
    expect(query).not.toContain("assignee");
  });

  test("Team focus is team-wide and the optional sprint filter narrows that scope", () => {
    const team = withView(initialQuery, View.Today);
    expect(jql(team)).toBe("statusCategory IS NOT EMPTY ORDER BY updated DESC");
    expect(jql({ ...team, sprintFilter: 42 })).toBe("sprint = 42 ORDER BY updated DESC");
    expect(jql({ ...initialQuery, view: View.Mine, sprintFilter: 42 })).toBe(
      "sprint = 42 AND assignee = currentUser() ORDER BY updated DESC",
    );
  });

  test("filters run on Jira and values are quoted", () => {
    const query = jql({
      ...initialQuery,
      view: View.Today,
      project: "EX",
      assignee: 'id" OR project=SECRET',
      status: "open",
    });
    expect(query).toContain('project = "EX"');
    expect(query).toContain('assignee = "id\\" OR project=SECRET"');
    expect(query).toContain("statusCategory != Done");
    expect(jql({ ...initialQuery, view: View.Today, assignee: "unassigned" })).toContain("assignee IS EMPTY");
  });

  test("Mentions reads recently updated issues and keeps project filters", () => {
    const query = jql({ ...initialQuery, view: View.Mentions, project: "EX" });
    expect(query).toContain("updated >= -14d");
    expect(query).toContain('project = "EX"');
  });

  test("Search finds words across Jira, or an issue by its key", () => {
    const search = (text: string) => jql({ ...initialQuery, view: View.Search, text, project: "EX" });
    expect(search('оплата "card" (v2)?')).toContain('text ~ "оплата card v2"');
    expect(search("ex-123")).toContain('key = "EX-123"');
    expect(search("x")).toContain('project = "EX"');
    expect(() => search("***")).toThrow("Type words");
  });

  test("Assigned resets the assignee filter; choosing a person there opens Team focus", () => {
    const team = { ...initialQuery, view: View.Today, assignee: "someone", limit: 600 };
    expect(withView(team, View.Mine)).toMatchObject({ assignee: "", limit: 200 });
    expect(withView(team, View.Created).assignee).toBe("someone");
    expect(withAssignee({ ...initialQuery, view: View.Mine }, "other")).toMatchObject({
      view: View.Today,
      assignee: "other",
    });
  });
});

describe("dates on screen", () => {
  test("are US style; anything unexpected is shown as Jira sent it", () => {
    expect(usDate("2026-11-05T13:08:14.000+0300")).toBe("11/05/2026");
    expect(usDateTime("2026-11-05 13:08")).toBe("11/05/2026 1:08 PM");
    expect(usDateTime("2026-11-05 00:30")).toBe("11/05/2026 12:30 AM");
    expect(usDateTime("2026-11-05 12:00")).toBe("11/05/2026 12:00 PM");
    expect(usDate("")).toBe("");
  });

  test("mention dates: short this year, with the year before it, a time today", () => {
    // Monday, November 9 2026, at noon in this computer's timezone.
    const now = new Date(2026, 10, 9, 12).getTime();
    expect(shortDate("2026-10-30 14:00", now)).toBe("Oct 30");
    expect(shortDate("2025-03-05 14:00", now)).toBe("Mar 5, 2025");
    expect(when("2026-11-09 14:14", now)).toBe("2:14 PM");
    expect(when("2026-11-08 14:14", now)).toBe("Nov 8");
  });

  test("sprint dates read as a short range, with the year once when it isn't this one", () => {
    const range = (start: string, end: string) =>
      sprintDates({ id: 1, name: "", state: "active", start, end, goal: "" });
    const thisYear = new Date().getFullYear();
    expect(range(`${thisYear}-11-03`, `${thisYear}-11-17`)).toBe("Nov 3–17");
    expect(range(`${thisYear}-10-20`, `${thisYear}-11-02`)).toBe("Oct 20–Nov 2");
    expect(range("2019-10-20", "2019-11-03")).toBe("Oct 20–Nov 3, 2019");
    expect(range("", "")).toBe("");
  });

  test("mention headings group by period", () => {
    const thursday = new Date(2026, 10, 12, 12).getTime();
    expect(period("2026-11-12 09:00", thursday)).toBe("Today");
    expect(period("2026-11-11 09:00", thursday)).toBe("Yesterday");
    expect(period("2026-11-09 09:00", thursday)).toBe("This week");
    expect(period("2026-11-08 09:00", thursday)).toBe("Earlier this month");
    expect(period("2026-10-30 09:00", thursday)).toBe("October");
    expect(period("2025-12-30 09:00", thursday)).toBe("2025");
  });
});
