import { describe, expect, test } from "bun:test";
import { rawComment, rawIssue, textDoc } from "../testing";
import { clean, clip } from "../text";
import { plainText, toDoc } from "./adf";
import { decode, RawIssue, toComments, toDetail, toIssue } from "./parse";
import { initialQuery, jql, View, withAssignee, withView } from "./query";
import { describeAttachment } from "./types";

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
    expect(detail.attachments.map(describeAttachment)).toEqual(["240 KB · Cameron · 2026-11-05"]);
  });
});

describe("scopes", () => {
  test("Created uses Jira's creator, not reporter or assignee", () => {
    const query = jql({ ...initialQuery, view: View.Created });
    expect(query).toContain("creator = currentUser()");
    expect(query).not.toContain("reporter");
    expect(query).not.toContain("assignee");
  });

  test("team and sprint scopes do not inherit personal restrictions", () => {
    expect(jql({ ...initialQuery, view: View.All })).not.toContain("currentUser()");
    expect(jql({ ...initialQuery, sprint: 24 })).toContain("sprint = 24");
    expect(() => jql(initialQuery)).toThrow("Choose a sprint");
  });

  test("filters run on Jira and values are quoted", () => {
    const query = jql({
      ...initialQuery,
      view: View.All,
      project: "EX",
      assignee: 'id" OR project=SECRET',
      status: "open",
    });
    expect(query).toContain('project = "EX"');
    expect(query).toContain('assignee = "id\\" OR project=SECRET"');
    expect(query).toContain("statusCategory != Done");
    expect(jql({ ...initialQuery, view: View.All, assignee: "unassigned" })).toContain("assignee IS EMPTY");
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

  test("personal views drop the person filter; choosing a person leaves them", () => {
    const team = { ...initialQuery, view: View.All, assignee: "someone", limit: 600 };
    expect(withView(team, View.Mine)).toMatchObject({ assignee: "", limit: 200 });
    expect(withView(team, View.Created).assignee).toBe("someone");
    expect(withAssignee({ ...initialQuery, view: View.Mine }, "other").view).toBe(View.All);
  });
});
