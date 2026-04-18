import type { SessionProvider, Session } from "../../shared/session";

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (days === 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function providerLabel(provider: SessionProvider): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
  }
}

export function repoNameForSession(session: Session): string {
  return session.repoPath.split("/").pop() || session.projectName;
}
