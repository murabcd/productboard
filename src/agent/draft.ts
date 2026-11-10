import type { Sprint } from "../jira/types";
import type { AgentImage } from "./images";

export interface DraftImage {
  kind: "image";
  label: string;
  state: { kind: "loading" } | { kind: "ready"; image: AgentImage } | { kind: "failed" };
}

export type SprintContext = Pick<Sprint, "id" | "name">;

export type DraftReference = { kind: "issue"; key: string } | { kind: "sprint"; sprint: SprintContext };

export type DraftAttachment =
  | DraftImage
  | { kind: "paste"; label: string; text: string }
  | (DraftReference & {
      label: string;
    });
export type Draft = readonly (string | DraftAttachment)[];

export function draftText(draft: Draft): string {
  return draft.map((part) => (typeof part === "string" ? part : part.label)).join("");
}

export function draftImages(draft: Draft): DraftImage[] {
  return draft.filter((part): part is DraftImage => typeof part !== "string" && part.kind === "image");
}

export function draftSprint(draft: Draft): SprintContext | undefined {
  for (const part of draft) {
    if (typeof part !== "string" && part.kind === "sprint") return part.sprint;
  }
}

export function expandDraft(draft: Draft): string {
  const prompt = draft
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.kind === "paste") return part.text;
      if (part.kind === "issue") return ` ${part.key} `;
      return "";
    })
    .join("");
  return draft.some((part) => typeof part !== "string" && part.kind === "paste") ? prompt : prompt.trim();
}
