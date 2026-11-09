/** Full-screen text panels: help, a sprint goal, or one issue's details. */

import { type DocBlock, textBlock } from "../jira/adf";
import { type Attachment, type Detail, describeAttachment, type Issue, type Sprint } from "../jira/types";
import { HELP } from "./help";

/** Issue panels own their details request; closing the panel drops it. */
export interface Panel {
  title: string;
  subtitle: string;
  /** Replaced, never edited in place, so its layout can be cached. */
  body: DocBlock[];
  error: string;
  scroll: number;
  issue?: Issue;
  loading: boolean;
  attachments: Attachment[];
}

const panel = (title: string, body: DocBlock[], extra: Partial<Panel> = {}): Panel => ({
  title,
  subtitle: "",
  body,
  error: "",
  scroll: 0,
  loading: false,
  attachments: [],
  ...extra,
});

export const helpPanel = (): Panel => panel("Keyboard shortcuts", [{ kind: "pre", text: HELP }]);

export function sprintPanel(sprint: Sprint): Panel {
  const dates = `${sprint.start.slice(0, 10) || "No start date"} → ${sprint.end.slice(0, 10) || "No end date"}`;
  return panel(sprint.name, [
    textBlock(`${sprint.state} · ${dates}`, "muted"),
    textBlock(sprint.goal || "No sprint goal."),
  ]);
}

/** An issue panel; its body arrives with `showDetail`. */
export const issuePanel = (issue: Issue): Panel =>
  panel(issue.summary, [], { subtitle: `${issue.key} · ${issue.status} · ${issue.assignee}`, issue });

export function showDetail(target: Panel, detail: Detail): void {
  target.body = detailBlocks(detail);
  target.attachments = detail.attachments;
}

/** Issue details in reading order: facts, description, comments, files. */
export function detailBlocks(detail: Detail): DocBlock[] {
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
      const byline = `${comment.author} · ${comment.created}`;
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
  return blocks;
}
