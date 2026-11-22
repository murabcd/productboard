import type { PickerSource } from "./pickers";

/** Conversation actions use the shared keyboard and search picker. */
export const CHAT_PICKERS = {
  chats: {
    title: "Saved chats",
    options: () => ({ filterChoices: false }),
    items: ({ agent }, query) => {
      const needle = query.trim().toLocaleLowerCase();
      return [...agent.chat.conversations]
        .reverse()
        .filter((thread) =>
          `${thread.name} ${thread.turns.map((turn) => `${turn.displayPrompt} ${turn.answer}`).join(" ")}`
            .toLocaleLowerCase()
            .includes(needle),
        )
        .map((thread) => ({
          value: thread.id,
          label: thread.name,
          detail: `${thread.turns.length} turns · ${new Date(thread.updated).toLocaleDateString()}`,
          current: thread === agent.chat.current,
          run: () => {
            agent.chat.open(thread.id);
            agent.tab = true;
          },
        }));
    },
  },
  "chat-rename": {
    title: "Rename chat",
    options: () => ({ filterChoices: false }),
    load: (d) => d.picker?.setQuery(d.agent.chat.current.name),
    items: ({ agent }, query) =>
      query.trim()
        ? [
            {
              value: "rename",
              label: `Save name: ${query.trim()}`,
              detail: "Enter to save",
              run: () => agent.chat.rename(query),
            },
          ]
        : [],
  },
  "chat-delete": {
    title: "Delete this saved chat?",
    items: ({ agent }) => [
      { value: "keep", label: "Keep chat", detail: agent.chat.current.name, run: () => {} },
      {
        value: "delete",
        label: "Delete chat",
        detail: "Removes its local record and attachments",
        run: () => agent.chat.delete(),
      },
    ],
  },
} satisfies Record<"chats" | "chat-rename" | "chat-delete", PickerSource>;
