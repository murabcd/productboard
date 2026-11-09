/** An in-terminal preview of an issue's image attachments. */

import type { Attachment } from "../jira/types";

export interface Preview {
  readonly images: Attachment[];
  index: number;
  /** The current image's content, once downloaded. */
  bytes: Uint8Array | null;
  loading: boolean;
  error: string;
}

export const currentImage = (preview: Preview): Attachment | undefined => preview.images[preview.index];

export function previewOf(images: Attachment[], start: Attachment): Preview {
  return { images, index: Math.max(0, images.indexOf(start)), bytes: null, loading: false, error: "" };
}

/** Recently viewed images, so flipping back and forth does not download again. */
export class ImageCache {
  private readonly images = new Map<string, Uint8Array>();

  constructor(private readonly limit = 12) {}

  get(id: string): Uint8Array | undefined {
    return this.images.get(id);
  }

  set(id: string, bytes: Uint8Array): void {
    this.images.delete(id);
    this.images.set(id, bytes);
    const oldest = this.images.keys().next().value;
    if (this.images.size > this.limit && oldest !== undefined) this.images.delete(oldest);
  }
}
