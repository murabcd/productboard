/** Charts are cell rows on the existing canvas, using the normal selection and status palette. */
import type { Breakdown } from "../state/views";
import { cells, clip } from "../text";
import type { Canvas, Style } from "./canvas";
import { statusIcon } from "./status";
import type { Bucket } from "./view-breakdown";

const AGE_STYLES: Record<string, Style> = {
  "0": "done",
  "8": "accent",
  "15": "review",
  "31": "error",
  unknown: "muted",
};

export function drawViewChart(canvas: Canvas, top: number, buckets: Bucket[], kind: Breakdown, cursor: number): void {
  const { width, height } = canvas;
  const all = buckets.flatMap((bucket) => bucket.issues);
  const open = all.filter((issue) => issue.category !== "done").length;
  canvas.put(
    top,
    2,
    kind === "status" ? `Open ${open}   Done ${all.length - open}` : `Open ${all.length}`,
    "muted",
    width - 4,
  );
  canvas.put(
    top + 2,
    2,
    { status: "Work by status", assignee: "Open work by assignee", age: "Open issue age" }[kind],
    "title",
  );
  const start = top + 4;
  if (!all.length) {
    canvas.put(start, 2, "No loaded issues in this breakdown", "muted", width - 4);
    return;
  }
  const capacity = Math.max(1, height - start - 2);
  const offset = Math.max(0, cursor - capacity + 1);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.issues.length));
  const labelWidth = Math.min(24, Math.max(14, Math.floor(width * 0.26)));
  const barWidth = Math.max(1, width - labelWidth - 19);
  const denominator = all.length;
  buckets.slice(offset, offset + capacity).forEach((bucket, index) => {
    const y = start + index;
    const selected = offset + index === cursor;
    if (selected) canvas.paint(y, 1, width - 2, "selected");
    const first = bucket.issues[0];
    const [icon, statusStyle] = kind === "status" && first ? statusIcon(first) : (["", "accent"] as const);
    const style =
      kind === "age"
        ? (AGE_STYLES[bucket.id] ?? "muted")
        : kind === "assignee" && bucket.id === "unassigned"
          ? "muted"
          : statusStyle;
    if (icon) canvas.put(y, 2, icon, style, 1);
    const label = clip(bucket.label, labelWidth - 2);
    canvas.put(y, 4, label, selected ? "selectedBold" : "text", labelWidth - 2);
    const length = bucket.issues.length ? Math.max(1, Math.round((bucket.issues.length / maximum) * barWidth)) : 0;
    const bar = "■".repeat(length);
    canvas.put(y, labelWidth + 3, bar, style, barWidth);
    const count = String(bucket.issues.length);
    canvas.put(y, width - 9 - cells(count), count, selected ? "selectedBold" : "text");
    const share = `${denominator ? Math.round((bucket.issues.length / denominator) * 100) : 0}%`;
    canvas.put(y, width - 2 - cells(share), share, "muted");
    canvas.mark(y, 1, width - 2, { kind: "view-bucket", id: bucket.id });
  });
}
