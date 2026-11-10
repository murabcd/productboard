import type { Sprint } from "../jira/types";
import { clean } from "../text";
import { type AgentImage, MAX_IMAGES, MAX_MESSAGE_IMAGE_BYTES, readAgentImage } from "./images";

interface DraftImage {
  kind: "image";
  label: string;
}

export type SprintContext = Pick<Sprint, "id" | "name">;
export type DraftReference = { kind: "issue"; key: string } | { kind: "sprint"; sprint: SprintContext };

export type DraftAttachment =
  | DraftImage
  | { kind: "paste"; label: string; text: string }
  | (DraftReference & { label: string });
export type DraftParts = readonly (string | DraftAttachment)[];

export class AgentDraft {
  private current: DraftParts = [];
  private readonly images = new WeakMap<DraftImage, AgentImage>();
  error = "";

  get parts(): DraftParts {
    return this.current;
  }

  get sprint(): (DraftAttachment & { kind: "sprint" }) | undefined {
    return this.current.find((part) => typeof part !== "string" && part.kind === "sprint");
  }

  get loading(): boolean {
    return this.imageTokens().some((token) => !this.images.has(token));
  }

  replace(parts: DraftParts): void {
    this.current = parts;
  }

  async attachImage(path: string, label: string, insert: (attachment: DraftAttachment) => void): Promise<void> {
    if (this.imageTokens().length >= MAX_IMAGES) {
      this.error = `Attach up to ${MAX_IMAGES} images per message.`;
      return;
    }
    const token: DraftImage = { kind: "image", label };
    this.error = "";
    insert(token);
    try {
      const image = await readAgentImage(path);
      if (!this.current.includes(token)) return;
      const bytes = this.imageTokens().reduce((size, part) => size + (this.images.get(part)?.bytes.byteLength ?? 0), 0);
      if (bytes + image.bytes.byteLength > MAX_MESSAGE_IMAGE_BYTES) {
        throw new Error("Images can be up to 6 MB per message.");
      }
      this.images.set(token, image);
    } catch (error) {
      if (!this.current.includes(token)) return;
      this.replace(this.current.filter((part) => part !== token));
      this.error = error instanceof Error && !("code" in error) ? clean(error.message) : "Could not read the image.";
    }
  }

  prepare() {
    const images: AgentImage[] = [];
    let prompt = "";
    let hasPaste = false;
    for (const part of this.current) {
      if (typeof part === "string") prompt += part;
      else if (part.kind === "paste") {
        hasPaste = true;
        prompt += part.text;
      } else if (part.kind === "issue") prompt += ` ${part.key} `;
      else if (part.kind === "image") {
        const image = this.images.get(part);
        if (!image) return;
        images.push(image);
      }
    }
    if (!prompt.trim() && !images.length) return;
    return {
      prompt: hasPaste ? prompt : prompt.trim(),
      displayPrompt: draftText(this.current).trim(),
      sprint: this.sprint?.sprint,
      images,
    };
  }

  private imageTokens(): DraftImage[] {
    return this.current.filter((part): part is DraftImage => typeof part !== "string" && part.kind === "image");
  }
}

export function draftText(parts: DraftParts): string {
  return parts.map((part) => (typeof part === "string" ? part : part.label)).join("");
}
