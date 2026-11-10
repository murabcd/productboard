import type { AgentImage } from "./images";

export interface DraftImage {
  kind: "image";
  label: string;
  state: { kind: "loading" } | { kind: "ready"; image: AgentImage } | { kind: "failed" };
}

export type DraftAttachment = DraftImage | { kind: "paste"; label: string; text: string };
export type Draft = readonly (string | DraftAttachment)[];

export function draftText(draft: Draft): string {
  return draft.map((part) => (typeof part === "string" ? part : part.label)).join("");
}

export function draftImages(draft: Draft): DraftImage[] {
  return draft.filter((part): part is DraftImage => typeof part !== "string" && part.kind === "image");
}

export function expandDraft(draft: Draft): string {
  const prompt = draft
    .map((part) => (typeof part === "string" ? part : part.kind === "paste" ? part.text : ""))
    .join("");
  return draft.some((part) => typeof part !== "string" && part.kind === "paste") ? prompt : prompt.trim();
}
