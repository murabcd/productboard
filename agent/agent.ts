import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";

// Productboard starts this agent and sets these; see agentChoice in src/auth.ts.
const { PRODUCTBOARD_AGENT_PROVIDER: provider, PRODUCTBOARD_AGENT_MODEL: model } = process.env;
const reasoning = process.env.PRODUCTBOARD_AGENT_REASONING;
if (!model || !reasoning) throw new Error("Start Agent from productboard, which chooses its model and reasoning.");
// Eve loads this file under Node, apart from the app, so it keeps its own copy
// of the levels; they match REASONING_LEVELS in src/auth.ts.
const levels = ["none", "low", "medium", "high", "xhigh"] as const;
const level = levels.find((name) => name === reasoning);
if (!level) throw new Error(`Unknown reasoning level: ${reasoning}`);

export default defineAgent({
  defaultTools: false,
  experimental: { workflow: { retention: 0 } },
  model: provider === "anthropic" ? anthropic(model) : openai(model),
  reasoning: level,
});
