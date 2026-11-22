/** A selected chart bar's loaded members; opening this drawer performs no Jira reads. */
import { textBlock } from "../jira/adf";
import type { Breakdown } from "../state/views";
import { cells } from "../text";
import { Canvas, type Style } from "./canvas";
import { layout } from "./document";
import { drawPeekLine, drawPeekPanel, type PeekRow } from "./peek-panel";
import { statusIcon } from "./status";
import type { Bucket } from "./view-breakdown";

export function drawViewPeek(
  bucket: Bucket,
  kind: Breakdown,
  total: number,
  state: { scroll: number },
  width: number,
  height: number,
): Canvas {
  const canvas = new Canvas(width, height, "panel");
  const room = width - 4;
  const rows: PeekRow[] = [];
  const line = (text: string, style: Style = "text") => rows.push((y) => canvas.put(y, 2, text, style, room));
  const blank = () => line("");
  const first = bucket.issues[0];
  const [icon, color] = kind === "status" && first ? statusIcon(first) : (["", "title"] as const);
  line(`${icon ? `${icon} ` : ""}${bucket.label}`, color);
  line(
    `${bucket.issues.length} of ${total} loaded · ${total ? Math.round((bucket.issues.length / total) * 100) : 0}%`,
    "muted",
  );
  if (!first) {
    blank();
    line("No loaded issues in this bar", "muted");
  } else {
    if (kind !== "assignee") {
      blank();
      line("Assignees", "title");
      const owners = new Map<string, { label: string; count: number }>();
      for (const issue of bucket.issues) {
        const owner = owners.get(issue.assigneeId) ?? { label: issue.assignee, count: 0 };
        owner.count++;
        owners.set(issue.assigneeId, owner);
      }
      for (const owner of [...owners.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))) {
        rows.push((y) => {
          canvas.put(y, 2, owner.label, "text", room - 4);
          canvas.put(y, width - 3 - cells(String(owner.count)), String(owner.count), "muted");
        });
      }
    }
    blank();
    line("Issues", "title");
    for (const issue of bucket.issues) {
      line(issue.key, "muted");
      for (const wrapped of layout([textBlock(issue.summary, "strong")], room)) {
        rows.push((y) => drawPeekLine(canvas, y, 2, wrapped));
      }
      if (kind !== "assignee") line(issue.assignee, "muted");
      if (issue.reason) {
        for (const wrapped of layout([textBlock(issue.reason, "error")], room)) {
          rows.push((y) => drawPeekLine(canvas, y, 2, wrapped));
        }
      }
      blank();
    }
  }
  const title = { status: "Status peek", assignee: "Assignee peek", age: "Age peek" }[kind];
  drawPeekPanel(canvas, title, state, rows);
  return canvas;
}
