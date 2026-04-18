import { setTimeout } from "node:timers/promises";
import { createWorktree } from "../../git.js";
import { SessionProviderAdapter, SessionSnapshot, PendingSession, WorktreeContext } from "../../agent.js";
import { listFilesRecursive, parseJsonLinesAs, readTextFileIfExists } from "../../agent-store-utils.js";
import {
  codexWorktreeCwd,
  getCodexHistoryPath,
  getCodexSessionsDir,
} from "./paths.js";

interface CodexSessionMeta {
  providerSessionId: string;
  project: string;
  timestamp: number;
}

interface CodexHistoryEntry {
  sessionId: string;
  text: string;
  timestamp: number;
}

function parseCodexTimestamp(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseCodexSessionMetaEntry(entry: unknown): CodexSessionMeta | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    timestamp?: unknown;
    payload?: {
      id?: unknown;
      cwd?: unknown;
      timestamp?: unknown;
    };
  };

  if (maybeEntry.type !== "session_meta" || !maybeEntry.payload) {
    return null;
  }
  if (typeof maybeEntry.payload.id !== "string" || typeof maybeEntry.payload.cwd !== "string") {
    return null;
  }

  const timestamp =
    parseCodexTimestamp(
      typeof maybeEntry.payload.timestamp === "string" ||
        typeof maybeEntry.payload.timestamp === "number"
        ? maybeEntry.payload.timestamp
        : null,
    ) ??
    parseCodexTimestamp(
      typeof maybeEntry.timestamp === "string" || typeof maybeEntry.timestamp === "number"
        ? maybeEntry.timestamp
        : null,
    ) ??
    0;

  return {
    providerSessionId: maybeEntry.payload.id,
    project: maybeEntry.payload.cwd,
    timestamp,
  };
}

function parseCodexHistoryEntry(entry: unknown): CodexHistoryEntry | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    session_id?: unknown;
    text?: unknown;
    ts?: unknown;
  };

  if (typeof maybeEntry.session_id !== "string" || typeof maybeEntry.ts !== "number") {
    return null;
  }

  return {
    sessionId: maybeEntry.session_id,
    text: typeof maybeEntry.text === "string" ? maybeEntry.text : "",
    timestamp: maybeEntry.ts * 1000,
  };
}

async function readCodexSessionMetas(): Promise<Map<string, CodexSessionMeta>> {
  const filePaths = await listFilesRecursive(getCodexSessionsDir());
  const metas = new Map<string, CodexSessionMeta>();

  await Promise.all(
    filePaths.map(async (filePath) => {
      const content = await readTextFileIfExists(filePath);
      if (!content) {
        return;
      }
      for (const entry of parseJsonLinesAs(content, parseCodexSessionMetaEntry)) {
        metas.set(entry.providerSessionId, entry);
        break;
      }
    }),
  );

  return metas;
}

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readCodexSessionMetas()).keys());
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const historyContent = await readTextFileIfExists(getCodexHistoryPath());
  const historyBySessionId = new Map<string, { lastMessage: string; timestamp: number }>();
  if (historyContent) {
    for (const entry of parseJsonLinesAs(historyContent, parseCodexHistoryEntry)) {
      const existing = historyBySessionId.get(entry.sessionId);
      if (!existing || entry.timestamp > existing.timestamp) {
        historyBySessionId.set(entry.sessionId, {
          lastMessage: entry.text,
          timestamp: entry.timestamp,
        });
      }
    }
  }

  const metas = await readCodexSessionMetas();
  return Array.from(metas.values()).map((meta) => {
    const history = historyBySessionId.get(meta.providerSessionId);
    return {
      provider: "codex",
      providerSessionId: meta.providerSessionId,
      project: meta.project,
      lastMessage: history?.lastMessage ?? "",
      timestamp: Math.max(meta.timestamp, history?.timestamp ?? 0),
    } satisfies SessionSnapshot;
  });
}

async function findSessionForLaunch(
  cwd: string,
  startedAt: number,
  existingSessionIds: ReadonlySet<string>,
): Promise<string | null> {
  const metas = await readCodexSessionMetas();
  const match = Array.from(metas.values())
    .filter(
      (meta) =>
        meta.project === cwd &&
        meta.timestamp >= startedAt - 2000 &&
        !existingSessionIds.has(meta.providerSessionId),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  return match?.providerSessionId ?? null;
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
  for (;;) {
    const launched = await findSessionForLaunch(
      pending.sessionCwd,
      pending.startedAt,
      pending.existingProviderSessionIds,
    );
    if (launched) {
      return launched;
    }
    if (pending.exited) {
      throw new Error("Codex exited before creating a session");
    }
    await setTimeout(1000);
  }
}

export const sessionProvider: SessionProviderAdapter = {
  definition: {
    id: "codex",
    label: "Codex",
  },
  command: "codex",
  resolvesSessionIdLazily: true,
  loadStoredSessions,
  async createNewLaunch(repoPath) {
    return {
      cwd: repoPath,
      args: [],
      sessionCwd: repoPath,
      existingProviderSessionIds: await listExistingSessionIds(),
    };
  },
  async createResumeLaunch(session) {
    return {
      cwd: session.project,
      args: ["resume", session.providerSessionId],
      sessionCwd: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    return {
      cwd: context.worktreePath,
      args: [],
      sessionCwd: context.worktreePath,
      existingProviderSessionIds: await listExistingSessionIds(),
    };
  },
  async prepareWorktree(context: WorktreeContext) {
    await createWorktree(context.repoPath, context.worktreePath, context.branchName);
  },
  async finalizeWorktree() {
    return;
  },
  resolveWorktreePath(repoPath, worktreeName) {
    return codexWorktreeCwd(repoPath, worktreeName);
  },
  waitForSessionId,
};
