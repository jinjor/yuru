import type { SessionProvider } from "../../shared/session.js";
import type { SessionProviderAdapter } from "./agent.js";
import { sessionProvider as claudeProvider } from "./claude/index.js";
import { sessionProvider as codexProvider } from "./codex/index.js";
import { sessionProvider as kimiProvider } from "./kimi/index.js";

export const sessionProviders: Record<SessionProvider, SessionProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
  kimi: kimiProvider,
};

export function getSessionProvider(providerId: SessionProvider): SessionProviderAdapter {
  const provider = sessionProviders[providerId];
  if (!provider) {
    throw new Error(`Unknown session provider: ${providerId}`);
  }
  return provider;
}
