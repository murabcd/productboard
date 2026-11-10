import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { clean } from "../text";

const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
} as const;

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGES = 4;
export const MAX_MESSAGE_IMAGE_BYTES = 6 * 1024 * 1024;
const INVALID_PATH = /[\r\n\0]/;
const QUOTED_PATH = /^(['"])(.*)\1$/;
const ESCAPED_QUOTE = /'\\''/g;
const ESCAPED_CHARACTER = /\\(.)/g;

export interface AgentImage {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** Rex and other terminals paste the dropped path, sometimes with shell quoting. */
export function pastedImagePath(text: string): string | undefined {
  let path = text.trim();
  if (!path || INVALID_PATH.test(path)) return;
  if (path.startsWith("file://")) {
    try {
      path = fileURLToPath(path);
    } catch {
      return;
    }
  } else {
    path = path.replace(QUOTED_PATH, "$2").replace(ESCAPED_QUOTE, "'").replace(ESCAPED_CHARACTER, "$1");
  }
  if (isAbsolute(path) && Object.hasOwn(MEDIA_TYPES, extname(path).toLowerCase())) return path;
}

export async function readAgentImage(path: string): Promise<AgentImage> {
  const extension = extname(path).toLowerCase();
  if (!Object.hasOwn(MEDIA_TYPES, extension)) throw new Error("Use a PNG, JPEG, GIF or WebP image.");
  const mediaType = MEDIA_TYPES[extension as keyof typeof MEDIA_TYPES];
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0) throw new Error("Choose a nonempty image file.");
    if (stat.size > MAX_IMAGE_BYTES) throw new Error("Images can be up to 3 MB each.");
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) throw new Error("The image changed while it was being attached.");
    const bytes = buffer.subarray(0, bytesRead);
    const matches = {
      "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      "image/gif": ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)),
      "image/webp": bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
    };
    if (!matches[mediaType]) throw new Error("The file contents do not match its image format.");
    return { filename: clean(basename(path)), mediaType, bytes };
  } finally {
    await file.close();
  }
}
