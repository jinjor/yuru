import type { SessionProvider } from "../../shared/session";

export function providerLabel(provider: SessionProvider): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
  }
}
