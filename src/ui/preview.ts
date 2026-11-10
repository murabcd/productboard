/** Image selection and downloads for the attachment preview. */

import type { JiraClient } from "../jira/client";
import type { Attachment } from "../jira/types";
import { message } from "../state/workspace";

interface ImageRead {
  state: { kind: "loading" } | { kind: "ready"; bytes: Uint8Array } | { kind: "error"; message: string };
}

export interface Preview {
  readonly images: Attachment[];
  readonly index: number;
  readonly image: Attachment;
  readonly read: ImageRead;
}

export class ImagePreviews {
  current: Preview | null = null;
  private readonly reads = new Map<string, ImageRead>();

  constructor(
    private readonly fetch: JiraClient["attachment"],
    private readonly redraw: () => void,
  ) {}

  open(images: Attachment[], start: Attachment): void {
    this.select(images, images.indexOf(start));
  }

  step(delta: number): void {
    if (!this.current) return;
    const { images, index } = this.current;
    this.select(images, (index + delta + images.length) % images.length);
  }

  close(): void {
    this.current = null;
  }

  private select(images: Attachment[], index: number): void {
    const image = images[index];
    if (!image) return;
    let read = this.reads.get(image.id);
    if (!read) {
      read = { state: { kind: "loading" } };
      this.reads.set(image.id, read);
      void this.load(image.id, read);
    }
    this.current = { images, index, image, read };
  }

  private async load(id: string, read: ImageRead): Promise<void> {
    try {
      read.state = { kind: "ready", bytes: await this.fetch(id) };
      this.reads.delete(id);
      this.reads.set(id, read);
      if (this.reads.size > 12) {
        for (const [key, cached] of this.reads) {
          if (cached.state.kind === "loading") continue;
          this.reads.delete(key);
          break;
        }
      }
    } catch (error) {
      this.reads.delete(id);
      read.state = { kind: "error", message: message(error) };
    }
    if (this.current?.read === read) this.redraw();
  }
}
