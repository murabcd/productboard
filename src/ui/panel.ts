/** Full-screen text panels: help, a sprint goal, or one issue's details. */

import { usDate, usDateTime } from "../dates";
import { type DocBlock, textBlock } from "../jira/adf";
import { type Detail, describeAttachment, type Issue, type Sprint } from "../jira/types";
import { HELP } from "./help";
import type { IssueRead } from "./issue-details";

export type Panel =
  | { kind: "text"; title: string; body: DocBlock[]; scroll: number }
  | { kind: "issue"; issue: Issue; read: IssueRead; scroll: number };

const panel = (title: string, body: DocBlock[]): Panel => ({ kind: "text", title, body, scroll: 0 });

export const helpPanel = (): Panel => panel("Keyboard shortcuts", [{ kind: "pre", text: HELP }]);

export function sprintPanel(sprint: Sprint): Panel {
  const dates = `${usDate(sprint.start) || "No start date"} → ${usDate(sprint.end) || "No end date"}`;
  return panel(sprint.name, [
    textBlock(`${sprint.state} · ${dates}`, "muted"),
    textBlock(sprint.goal || "No sprint goal."),
  ]);
}

const bodies = new WeakMap<Detail, DocBlock[]>();

/** Issue details in reading order: facts, description, comments, files. */
export function detailBlocks(detail: Detail): DocBlock[] {
  const cached = bodies.get(detail);
  if (cached) return cached;
  const blocks: DocBlock[] = [];
  if (detail.facts.length) blocks.push(textBlock(detail.facts.join("\n"), "muted"));
  blocks.push(...(detail.description.length ? detail.description : [textBlock("No description.", "muted")]));

  blocks.push({ kind: "rule" });
  if (detail.comments.length) {
    const mentioned = detail.comments.filter((c) => c.mentionsMe).length;
    let heading = `Comments · ${detail.comments.length}`;
    if (mentioned) heading += ` · ${mentioned} mention${mentioned > 1 ? "s" : ""} you`;
    blocks.push({ kind: "heading", level: 2, spans: [{ text: `${heading} · newest first`, style: "strong" }] });
    for (const comment of detail.comments) {
      const byline = `${comment.author} · ${usDateTime(comment.created)}`;
      blocks.push(
        comment.mentionsMe
          ? textBlock(`● ${byline} · mentions you`, "mention", { keep: true })
          : textBlock(byline, "muted", { keep: true }),
        ...(comment.doc.length ? comment.doc : [textBlock("(empty comment)", "muted")]),
      );
    }
  } else {
    blocks.push(textBlock("No comments.", "muted"));
  }
  if (detail.attachments.length) {
    blocks.push(
      {
        kind: "heading",
        level: 2,
        spans: [{ text: `Attachments · ${detail.attachments.length} · i to open`, style: "strong" }],
      },
      textBlock(detail.attachments.map((item) => `${item.filename} · ${describeAttachment(item)}`).join("\n"), "muted"),
    );
  }
  bodies.set(detail, blocks);
  return blocks;
}
