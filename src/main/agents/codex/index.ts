import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import readline from "readline";
import { createWorktree } from "../../git.js";
import { exec } from "../../exec.js";
import type {
  PendingSession,
  SessionProviderAdapter,
  SessionSnapshot,
  WorktreeContext,
} from "../../agent.js";
import {
  listFilesRecursive,
  parseJsonLinesAs,
  readTextFileIfExists,
} from "../../agent-store-utils.js";
import type { WorktreeSessionHint } from "../../worktree-session-detection.js";
import { codexWorktreeCwd, getCodexHistoryPath, getCodexSessionsDir } from "./paths.js";
import { loadWorktreeContextPrompt } from "../../worktree-context-prompt.js";
import {
  detectCodexWorktreeSessionLines,
  type CodexSessionLine,
} from "./worktree-session-detection.js";

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
      const meta = await readCodexSessionMeta(filePath);
      if (meta) {
        metas.set(meta.providerSessionId, meta);
      }
    }),
  );

  return metas;
}

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readCodexSessionMetas()).keys());
}

async function hasStoredSession(providerSessionId: string): Promise<boolean> {
  return (await readCodexSessionMetas()).has(providerSessionId);
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

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }

  const worktreePathKeys = new Set(worktreePaths.map((worktreePath) => path.resolve(worktreePath)));
  const hints: WorktreeSessionHint[] = [];
  await Promise.all(
    Array.from(await listCodexSessionLineMatches(worktreePaths)).map(async ([filePath, lines]) => {
      const meta = await readCodexSessionMeta(filePath);
      if (!meta) {
        return;
      }
      hints.push(
        ...detectCodexWorktreeSessionLines(
          { providerSessionId: meta.providerSessionId, cwd: meta.project },
          lines,
          worktreePaths,
        ).filter((hint) => worktreePathKeys.has(path.resolve(hint.worktreePath))),
      );
    }),
  );

  return hints;
}

async function readCodexSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) {
        continue;
      }
      try {
        const meta = parseCodexSessionMetaEntry(JSON.parse(line) as unknown);
        if (meta) {
          return meta;
        }
      } catch {
        // Ignore malformed JSONL rows.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return null;
}

async function listCodexSessionLineMatches(
  worktreePaths: readonly string[],
): Promise<Map<string, CodexSessionLine[]>> {
  const sessionsDir = getCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return new Map();
  }

  const worktreePathPatterns = Array.from(
    new Set(
      worktreePaths
        .map((worktreePath) => path.resolve(worktreePath))
        .filter((worktreePath) => worktreePath.length > 0),
    ),
  );
  if (worktreePathPatterns.length === 0) {
    return new Map();
  }

  const args = [
    "--json",
    "--fixed-strings",
    "--hidden",
    ...worktreePathPatterns.flatMap((worktreePath) => ["--regexp", worktreePath]),
    "--",
    sessionsDir,
  ];

  try {
    const output = await exec("rg", args, sessionsDir);
    return parseRipgrepJsonLineMatches(output);
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 1) {
      return new Map();
    }
    throw error;
  }
}

function parseRipgrepJsonLineMatches(output: string): Map<string, CodexSessionLine[]> {
  const matchesByFilePath = new Map<string, CodexSessionLine[]>();

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    if (typeof message !== "object" || message === null) {
      continue;
    }

    const match = message as {
      type?: unknown;
      data?: {
        path?: { text?: unknown };
        lines?: { text?: unknown };
        line_number?: unknown;
      };
    };
    if (match.type !== "match") {
      continue;
    }
    if (
      typeof match.data?.path?.text !== "string" ||
      typeof match.data?.lines?.text !== "string" ||
      typeof match.data?.line_number !== "number"
    ) {
      continue;
    }

    const filePath = match.data.path.text;
    const lines = matchesByFilePath.get(filePath) ?? [];
    lines.push({
      text: stripTrailingLineBreak(match.data.lines.text),
      lineIndex: match.data.line_number - 1,
    });
    matchesByFilePath.set(filePath, lines);
  }

  for (const lines of matchesByFilePath.values()) {
    lines.sort((a, b) => a.lineIndex - b.lineIndex);
  }

  return matchesByFilePath;
}

function stripTrailingLineBreak(line: string): string {
  return line.replace(/\r?\n$/, "");
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
      pending.launchCwd,
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
  loadWorktreeSessionHints,
  hasStoredSession,
  async createResumeLaunch(session) {
    return {
      cwd: session.repoPath,
      args: ["resume", "--all", session.providerSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    const prompt = await loadWorktreeContextPrompt(context);
    return {
      cwd: context.repoPath,
      args: ["-c", `developer_instructions=${JSON.stringify(prompt)}`],
      worktreePath: context.worktreePath,
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
