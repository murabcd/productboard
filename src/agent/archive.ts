import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ConversationData } from "./conversation";

const SavedChat = z.object({ version: z.literal(1), conversation: ConversationData });

/** One private, atomic file per conversation; writes are serialized with deletes. */
export class ChatArchive {
  private writing = Promise.resolve();
  readonly entries: ConversationData[] = [];
  error = "";

  private constructor(private readonly directory: string) {}

  static path(site: string, email: string): string {
    const account = createHash("sha256").update(`${site}\n${email}`).digest("hex");
    return join(homedir(), ".local", "state", "productboard", account, "chats");
  }

  static async open(directory: string): Promise<ChatArchive> {
    const archive = new ChatArchive(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    await Promise.all(
      files.map(async (file) => {
        try {
          const data = SavedChat.parse(JSON.parse(await readFile(join(directory, file), "utf8")));
          if (file !== `${data.conversation.id}.json`) throw new Error("Chat filename does not match its ID");
          archive.entries.push(data.conversation);
        } catch {
          archive.error = "Some saved chats could not be read. Their files were kept.";
        }
      }),
    );
    archive.entries.sort((a, b) => a.updated - b.updated);
    return archive;
  }

  save(conversation: ConversationData): Promise<void> {
    const text = JSON.stringify(z.encode(SavedChat, { version: 1, conversation }));
    return this.enqueue(async () => {
      const path = join(this.directory, `${conversation.id}.json`);
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  remove(id: string): Promise<void> {
    return this.enqueue(() => rm(join(this.directory, `${z.uuid().parse(id)}.json`), { force: true }));
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const writing = this.writing.then(write);
    this.writing = writing.catch(() => {});
    return writing;
  }
}
