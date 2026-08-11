import { setTimeout } from "node:timers/promises";
import fs from "fs";
import path from "path";
import readline from "readline";
import { streamRipgrepLineMatches } from "../../ripgrep.js";
import type { PendingSession, SessionPreview, Agent, SessionSnapshot } from "../agent.js";
import { listFilesRecursive, parseJsonLinesAs, readTextFileIfExists } from "../store-utils.js";
import type { WorktreeSessionHint } from "../../sessions/detection.js";
import { codexSessionDateDirFromId, getCodexHistoryPath, getCodexSessionsDir } from "./paths.js";
import { loadWorktreeContextPrompt } from "../../sessions/context-prompt.js";
import { detectCodexWorktreeSessionLines } from "./session-detection.js";
import { IncrementalSessionPreviewReader } from "../preview-reader.js";
import { loadCodexPlanUsage } from "./plan-usage.js";

interface CodexSessionMeta {
  agentSessionId: string;
  project: string;
  timestamp: number;
  filePath: string;
}

interface CodexHistoryEntry {
  sessionId: string;
  timestamp: number;
}

const sessionFilePathsById = new Map<string, string>();

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

function parseCodexSessionMetaEntry(entry: unknown): Omit<CodexSessionMeta, "filePath"> | null {
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
    agentSessionId: maybeEntry.payload.id,
    project: maybeEntry.payload.cwd,
    timestamp,
  };
}

function parseCodexAssistantPreviewEntry(entry: unknown): SessionPreview | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    type?: unknown;
    timestamp?: unknown;
    payload?: {
      type?: unknown;
      role?: unknown;
      content?: unknown;
    };
  };

  if (
    maybeEntry.type !== "response_item" ||
    maybeEntry.payload?.type !== "message" ||
    maybeEntry.payload.role !== "assistant"
  ) {
    return null;
  }

  const lastMessage = extractCodexMessageText(maybeEntry.payload.content);
  if (!lastMessage) {
    return null;
  }
  return {
    lastMessage,
    timestamp:
      parseCodexTimestamp(
        typeof maybeEntry.timestamp === "string" || typeof maybeEntry.timestamp === "number"
          ? maybeEntry.timestamp
          : null,
      ) ?? 0,
  };
}

const sessionPreviewReader = new IncrementalSessionPreviewReader(parseCodexAssistantPreviewEntry);

function detectUserActionRequired(terminalTitle: string): boolean {
  return terminalTitle.includes("Action Required |");
}

function parseCodexHistoryEntry(entry: unknown): CodexHistoryEntry | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const maybeEntry = entry as {
    session_id?: unknown;
    ts?: unknown;
  };
  if (typeof maybeEntry.session_id !== "string" || typeof maybeEntry.ts !== "number") {
    return null;
  }
  return {
    sessionId: maybeEntry.session_id,
    timestamp: maybeEntry.ts * 1000,
  };
}

function extractCodexMessageText(content: unknown): string {
  const texts: string[] = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const maybeItem = item as { type?: unknown; text?: unknown };
      if (
        (maybeItem.type === "output_text" || maybeItem.type === "text") &&
        typeof maybeItem.text === "string"
      ) {
        texts.push(maybeItem.text);
      }
    }
  }

  return normalizePreviewText(texts.join("\n"));
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function readCodexSessionMetas(): Promise<Map<string, CodexSessionMeta>> {
  const filePaths = await listFilesRecursive(getCodexSessionsDir());
  const metas = new Map<string, CodexSessionMeta>();

  await Promise.all(
    filePaths.map(async (filePath) => {
      const meta = await readCodexSessionMeta(filePath);
      if (meta) {
        metas.set(meta.agentSessionId, meta);
        sessionFilePathsById.set(meta.agentSessionId, filePath);
      }
    }),
  );

  return metas;
}

async function listExistingSessionIds(): Promise<Set<string>> {
  return new Set((await readCodexSessionMetas()).keys());
}

async function hasStoredSession(agentSessionId: string): Promise<boolean> {
  return (await findCodexSessionFile(agentSessionId)) !== null;
}

async function loadStoredSessions(): Promise<SessionSnapshot[]> {
  const historyContent = await readTextFileIfExists(getCodexHistoryPath());
  const historyTimestampsBySessionId = new Map<string, number>();
  if (historyContent) {
    for (const entry of parseJsonLinesAs(historyContent, parseCodexHistoryEntry)) {
      const existingTimestamp = historyTimestampsBySessionId.get(entry.sessionId) ?? 0;
      if (entry.timestamp > existingTimestamp) {
        historyTimestampsBySessionId.set(entry.sessionId, entry.timestamp);
      }
    }
  }

  const metas = await readCodexSessionMetas();
  return Promise.all(
    Array.from(metas.values()).map(async (meta) => {
      const preview = await readCodexSessionPreview(meta.filePath);
      const historyTimestamp = historyTimestampsBySessionId.get(meta.agentSessionId) ?? 0;
      return {
        provider: "codex",
        agentSessionId: meta.agentSessionId,
        project: meta.project,
        lastMessage: preview?.lastMessage ?? "",
        timestamp: Math.max(meta.timestamp, preview?.timestamp ?? 0, historyTimestamp),
      } satisfies SessionSnapshot;
    }),
  );
}

async function loadStoredSessionPreview(agentSessionId: string): Promise<SessionPreview | null> {
  const sessionFilePath = await findCodexSessionFile(agentSessionId);
  return sessionFilePath ? readCodexSessionPreview(sessionFilePath) : null;
}

async function findCodexSessionFile(agentSessionId: string): Promise<string | null> {
  const cachedFilePath = sessionFilePathsById.get(agentSessionId);
  if (cachedFilePath && fs.existsSync(cachedFilePath)) {
    return cachedFilePath;
  }
  const sessionDateDir = codexSessionDateDirFromId(agentSessionId);
  if (!sessionDateDir || !fs.existsSync(sessionDateDir)) {
    return null;
  }

  const sessionId = agentSessionId.toLowerCase();
  const sessionFileName =
    fs.readdirSync(sessionDateDir).find((fileName) => fileName.endsWith(`-${sessionId}.jsonl`)) ??
    null;
  if (!sessionFileName) {
    return null;
  }
  const filePath = path.join(sessionDateDir, sessionFileName);
  sessionFilePathsById.set(agentSessionId, filePath);
  return filePath;
}

async function readCodexSessionPreview(filePath: string): Promise<SessionPreview | null> {
  return sessionPreviewReader.read(filePath);
}

async function loadWorktreeSessionHints(
  worktreePaths: readonly string[],
): Promise<WorktreeSessionHint[]> {
  if (worktreePaths.length === 0) {
    return [];
  }

  const sessionsDir = getCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const worktreePathKeys = new Set(worktreePaths.map((worktreePath) => path.resolve(worktreePath)));
  const hints: WorktreeSessionHint[] = [];
  await streamRipgrepLineMatches(
    [
      "--fixed-strings",
      "--hidden",
      ...Array.from(worktreePathKeys).flatMap((worktreePath) => ["--regexp", worktreePath]),
      "--",
      sessionsDir,
    ],
    sessionsDir,
    async (filePath, lines) => {
      const meta = await readCodexSessionMeta(filePath);
      if (!meta) {
        return;
      }
      hints.push(
        ...detectCodexWorktreeSessionLines(
          { agentSessionId: meta.agentSessionId, cwd: meta.project },
          lines,
          worktreePaths,
        ).filter((hint) => worktreePathKeys.has(path.resolve(hint.worktreePath))),
      );
    },
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
        const parsedMeta = parseCodexSessionMetaEntry(JSON.parse(line) as unknown);
        const meta = parsedMeta ? { ...parsedMeta, filePath } : null;
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
        !existingSessionIds.has(meta.agentSessionId),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  return match?.agentSessionId ?? null;
}

async function waitForSessionId(pending: PendingSession): Promise<string> {
  for (;;) {
    const launched = await findSessionForLaunch(
      pending.launchCwd,
      pending.startedAt,
      pending.existingAgentSessionIds,
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

export const agent: Agent = {
  definition: {
    id: "codex",
    label: "Codex",
  },
  command: "codex",
  resolvesSessionIdLazily: true,
  loadStoredSessions,
  loadStoredSessionPreview,
  loadWorktreeSessionHints,
  hasStoredSession,
  loadPlanUsage: loadCodexPlanUsage,
  async createResumeLaunch(session) {
    // Resume in the directory the session was recorded under (provided by the
    // caller), not the repo root. Codex keys each session by its cwd and, if
    // resumed from a different directory, stops to ask which one to use.
    return {
      cwd: session.cwd,
      args: ["resume", "--all", session.agentSessionId],
      worktreePath: session.project,
    };
  },
  async createWorktreeLaunch(context) {
    const prompt = await loadWorktreeContextPrompt(context);
    const args: string[] = [];
    if (context.model !== undefined) {
      args.push("--model", context.model);
    }
    args.push("-c", `developer_instructions=${JSON.stringify(prompt)}`);
    if (context.initialPrompt !== undefined) {
      args.push("--", context.initialPrompt);
    }
    return {
      cwd: context.repoPath,
      args,
      worktreePath: context.worktreePath,
      existingAgentSessionIds: await listExistingSessionIds(),
    };
  },
  waitForSessionId,
  detectUserActionRequired,
};
