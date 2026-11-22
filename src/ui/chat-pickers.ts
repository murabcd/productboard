import type { PickerSource } from "./pickers";

/** Conversation actions use the shared keyboard and search picker. */
export const CHAT_PICKERS = {
  "agent-retry": {
    title: "Retry a failed or interrupted reply",
    items: ({ agent }) =>
      agent.chat.current.turns
        .filter((turn) => turn.state.kind === "failed" || turn.state.kind === "interrupted")
        .map((turn, index) => ({
          value: turn.id,
          label: `${index + 1}. ${turn.displayPrompt}`,
          detail: turn.state.kind === "failed" ? turn.state.error : "Interrupted",
          run: () => void agent.chat.retry(turn.id),
        })),
  },
  "agent-answers": {
    title: "Copy an answer",
    items: (d) =>
      d.agent.chat.current.turns
        .filter((turn) => turn.answer.trim())
        .map((turn, index) => ({
          value: turn.id,
          label: `${index + 1}. ${turn.displayPrompt}`,
          detail: turn.answer.slice(0, 100),
          run: () => d.copyAgentAnswer(turn.id),
        })),
  },
  "agent-fork": {
    title: "Fork chat through this reply",
    items: ({ agent }) =>
      agent.chat.current.turns
        .filter((turn) => turn.state.kind !== "running")
        .map((turn, index) => ({
          value: turn.id,
          label: `${index + 1}. ${turn.displayPrompt}`,
          detail: turn.answer.slice(0, 100),
          run: () => agent.chat.fork(turn.id),
        })),
  },
  "agent-tools": {
    title: "Jira tool activity",
    items: (d) =>
      d.agent.chat.current.turns.flatMap((turn, index) =>
        turn.tools.map((tool) => ({
          value: `${turn.id}/${tool.id}`,
          label: `${index + 1}. ${tool.name} · ${tool.query}`,
          detail: tool.error || tool.detail,
          run: () => d.openAgentTool(turn.id, tool.id),
        })),
      ),
  },
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
} satisfies Record<
  "chats" | "chat-rename" | "chat-delete" | "agent-tools" | "agent-answers" | "agent-fork" | "agent-retry",
  PickerSource
>;
