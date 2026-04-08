import { SessionProvider } from "../shared/session.js";
import { AgentDefinition } from "../shared/agent.js";
import { SessionProviderAdapter } from "./agent.js";
import { sessionProvider as claudeProvider } from "./agents/claude/index.js";
import { sessionProvider as codexProvider } from "./agents/codex/index.js";

export const sessionProviders: Record<SessionProvider, SessionProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
};

export function getSessionProvider(providerId: SessionProvider): SessionProviderAdapter {
  const provider = sessionProviders[providerId];
  if (!provider) {
    throw new Error(`Unknown session provider: ${providerId}`);
  }
  return provider;
}

export function listSessionProviderDefinitions(): AgentDefinition[] {
  return Object.values(sessionProviders).map((provider) => provider.definition);
}
