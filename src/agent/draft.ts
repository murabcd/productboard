import { z } from "zod";
import { clean } from "../text";
import { AgentImage, MAX_IMAGES, MAX_MESSAGE_IMAGE_BYTES, readAgentImage } from "./images";

export const SprintContext = z.object({ id: z.number().int(), name: z.string() });
export type SprintContext = z.infer<typeof SprintContext>;
export type DraftReference = { kind: "issue"; key: string } | { kind: "sprint"; sprint: SprintContext };

export const DraftAttachment = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), label: z.string() }),
  z.object({ kind: z.literal("paste"), label: z.string(), text: z.string() }),
  z.object({ kind: z.literal("issue"), label: z.string(), key: z.string() }),
  z.object({ kind: z.literal("sprint"), label: z.string(), sprint: SprintContext }),
]);
export type DraftAttachment = z.infer<typeof DraftAttachment>;
type DraftImage = Extract<DraftAttachment, { kind: "image" }>;
export const DraftParts = z.array(z.union([z.string(), DraftAttachment])).readonly();
export type DraftParts = z.infer<typeof DraftParts>;
export const DraftSnapshot = z.object({ parts: DraftParts, images: z.array(AgentImage).readonly() });
export type DraftSnapshot = z.infer<typeof DraftSnapshot>;

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

  snapshot(): DraftSnapshot {
    const images: AgentImage[] = [];
    const parts = this.current.filter((part) => {
      if (typeof part === "string" || part.kind !== "image") return true;
      const image = this.images.get(part);
      if (!image) return false;
      images.push(image);
      return true;
    });
    return { parts, images };
  }

  restore({ parts, images }: DraftSnapshot): void {
    this.replace(parts);
    let index = 0;
    for (const token of this.imageTokens()) {
      const image = images[index++];
      if (image) this.images.set(token, image);
    }
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
