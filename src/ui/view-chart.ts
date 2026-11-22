/** Charts are cell rows on the existing canvas, using the normal selection and status palette. */
import type { Breakdown } from "../state/views";
import { cells, clip } from "../text";
import type { Canvas } from "./canvas";
import { statusIcon } from "./status";
import type { Bucket } from "./view-breakdown";

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
    const [icon, style] = kind === "status" && first ? statusIcon(first) : (["", "accent"] as const);
    const label = clip(`${icon ? `${icon} ` : ""}${bucket.label}`, labelWidth);
    canvas.put(y, 2, label, selected ? "selectedBold" : "text", labelWidth);
    const bar = "▏".repeat(Math.round((bucket.issues.length / maximum) * barWidth));
    canvas.put(y, labelWidth + 3, bar, style, barWidth);
    const count = String(bucket.issues.length);
    canvas.put(y, width - 9 - cells(count), count, selected ? "selectedBold" : "text");
    const share = `${denominator ? Math.round((bucket.issues.length / denominator) * 100) : 0}%`;
    canvas.put(y, width - 2 - cells(share), share, "muted");
    canvas.mark(y, 1, width - 2, { kind: "view-bucket", id: bucket.id });
  });
  if (!denominator)
    canvas.put(
      Math.min(start + buckets.length + 1, height - 3),
      2,
      "No loaded issues in this breakdown",
      "muted",
      width - 4,
    );
}
