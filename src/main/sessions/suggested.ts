import path from "path";
import { agents } from "../agents/registry.js";
import type { WorktreeSessionHint } from "../agents/session-detection.js";
import {
  toSessionKey,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../../shared/session.js";

interface WorktreeSessionScore {
  provider: SessionProvider;
  agentSessionId: string;
  worktreePath: string;
  worktreeRank: number;
  cwd: string;
  timestamp: number;
}

async function loadStoredSessionSnapshots() {
  return (
    await Promise.all(Object.values(agents).map((agent) => agent.loadStoredSessions()))
  ).flat();
}

export async function loadStoredSessionPreviews(): Promise<Map<string, string>> {
  const previews = new Map<string, string>();
  for (const snapshot of await loadStoredSessionSnapshots()) {
    previews.set(toSessionKey(snapshot.provider, snapshot.agentSessionId), snapshot.lastMessage);
  }
  return previews;
}

export async function loadStoredSessionPreview(
  provider: SessionProvider,
  agentSessionId: string,
): Promise<string | null> {
  return (await agents[provider].loadStoredSessionPreview(agentSessionId))?.lastMessage ?? null;
}

export async function loadSuggestedWorktreeSessions(
  worktreePaths: readonly string[],
): Promise<Map<string, SuggestedWorktreeSession[]>> {
  const worktreePathByKey = new Map(
    worktreePaths.map((worktreePath) => [path.resolve(worktreePath), worktreePath]),
  );
  const suggestionsByWorktreePath = new Map<string, SuggestedWorktreeSession[]>();
  const snapshotsBySessionKey = new Map(
    (await loadStoredSessionSnapshots()).map((snapshot) => [
      toSessionKey(snapshot.provider, snapshot.agentSessionId),
      { timestamp: snapshot.timestamp, cwd: snapshot.project },
    ]),
  );
  const hints = (
    await Promise.all(
      Object.values(agents).map((agent) => agent.loadWorktreeSessionHints(worktreePaths)),
    )
  )
    .flat()
    .flatMap((hint) => {
      const worktreePath = worktreePathByKey.get(path.resolve(hint.worktreePath));
      return worktreePath ? [{ ...hint, worktreePath }] : [];
    });

  for (const score of rankWorktreeSessionScores(hints, snapshotsBySessionKey)) {
    const suggestions = suggestionsByWorktreePath.get(score.worktreePath) ?? [];
    suggestions.push({
      provider: score.provider,
      agentSessionId: score.agentSessionId,
      cwd: score.cwd,
      timestamp: score.timestamp,
    });
    suggestionsByWorktreePath.set(score.worktreePath, suggestions);
  }

  return suggestionsByWorktreePath;
}

function rankWorktreeSessionScores(
  hints: readonly WorktreeSessionHint[],
  snapshotsBySessionKey: ReadonlyMap<string, { timestamp: number; cwd: string }>,
): WorktreeSessionScore[] {
  const scoresByKey = new Map<string, WorktreeSessionScore>();

  for (const hint of hints) {
    const sessionKey = toSessionKey(hint.provider, hint.agentSessionId);
    const scoreKey = `${sessionKey}:${hint.worktreePath}`;
    const snapshot = snapshotsBySessionKey.get(sessionKey);
    const nextScore: WorktreeSessionScore = {
      provider: hint.provider,
      agentSessionId: hint.agentSessionId,
      worktreePath: hint.worktreePath,
      worktreeRank: hint.worktreeRank,
      // Sessions without a snapshot have no resumable store entry; fall back to
      // the detected worktree so the type stays a plain string.
      cwd: snapshot?.cwd ?? hint.worktreePath,
      timestamp: snapshot?.timestamp ?? 0,
    };
    const existingScore = scoresByKey.get(scoreKey);
    if (!existingScore || compareWorktreeSessionScores(nextScore, existingScore) < 0) {
      scoresByKey.set(scoreKey, nextScore);
    }
  }

  return Array.from(scoresByKey.values()).sort(compareWorktreeSessionScores);
}

function compareWorktreeSessionScores(a: WorktreeSessionScore, b: WorktreeSessionScore): number {
  const worktreePathOrder = a.worktreePath.localeCompare(b.worktreePath);
  if (worktreePathOrder !== 0) {
    return worktreePathOrder;
  }
  const worktreeRankOrder = a.worktreeRank - b.worktreeRank;
  if (worktreeRankOrder !== 0) {
    return worktreeRankOrder;
  }
  const providerOrder = a.provider.localeCompare(b.provider);
  if (providerOrder !== 0) {
    return providerOrder;
  }
  return a.agentSessionId.localeCompare(b.agentSessionId);
}
