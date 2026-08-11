import type { SessionProvider } from "../../shared/session.js";
import type { Agent } from "./agent.js";
import { agent as claudeAgent } from "./claude/index.js";
import { agent as codexAgent } from "./codex/index.js";
import { agent as kimiAgent } from "./kimi/index.js";

export const agents: Record<SessionProvider, Agent> = {
  claude: claudeAgent,
  codex: codexAgent,
  kimi: kimiAgent,
};

export function getAgent(provider: SessionProvider): Agent {
  const agent = agents[provider];
  if (!agent) {
    throw new Error(`Unknown session provider: ${provider}`);
  }
  return agent;
}
