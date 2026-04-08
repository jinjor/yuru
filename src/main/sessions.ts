import fs from "fs";
import os from "os";
import path from "path";
import { listWorktrees } from "./git.js";
import { historyPath as claudeHistoryPath } from "./claude-paths.js";
import { repoPathFromCwd } from "./worktree-paths.js";
import { Session, SessionProvider, toSessionKey } from "../shared/session.js";

const codexDir = path.join(os.homedir(), ".codex");
const codexHistoryPath = path.join(codexDir, "history.jsonl");
const codexSessionsDir = path.join(codexDir, "sessions");

interface SessionSnapshot {
  provider: SessionProvider;
  providerSessionId: string;
  project: string;
  lastMessage: string;
  timestamp: number;
}

interface RuntimeSessionInfo {
  cwd: string;
  provider: SessionProvider;
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.promises.readFile(filePath, "utf-8");
}

function parseJsonLines(content: string): unknown[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

async function loadClaudeSessions(): Promise<SessionSnapshot[]> {
  const content = await readTextFileIfExists(claudeHistoryPath);
  if (!content) {
    return [];
  }

  const sessionMap = new Map<string, SessionSnapshot>();
  for (const entry of parseJsonLines(content)) {
    const sid = typeof (entry as { sessionId?: unknown }).sessionId === "string"
      ? (entry as { sessionId: string }).sessionId
      : null;
    const project = typeof (entry as { project?: unknown }).project === "string"
      ? (entry as { project: string }).project
      : null;
    const display = typeof (entry as { display?: unknown }).display === "string"
      ? (entry as { display: string }).display
      : "";
    const timestamp = typeof (entry as { timestamp?: unknown }).timestamp === "number"
      ? (entry as { timestamp: number }).timestamp
      : null;
    if (!sid || !project || timestamp === null) {
      continue;
    }

    const existing = sessionMap.get(sid);
    if (!existing || timestamp > existing.timestamp) {
      sessionMap.set(sid, {
        provider: "claude",
        providerSessionId: sid,
        project,
        lastMessage: display,
        timestamp,
      });
    }
  }

  return Array.from(sessionMap.values());
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await listFilesRecursive(nextPath)));
    } else if (entry.isFile()) {
      filePaths.push(nextPath);
    }
  }
  return filePaths;
}

interface CodexSessionMeta {
  providerSessionId: string;
  project: string;
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

async function readCodexSessionMetas(): Promise<Map<string, CodexSessionMeta>> {
  const filePaths = await listFilesRecursive(codexSessionsDir);
  const metas = new Map<string, CodexSessionMeta>();

  await Promise.all(
    filePaths.map(async (filePath) => {
      const content = await fs.promises.readFile(filePath, "utf-8");
      for (const entry of parseJsonLines(content)) {
        const recordType = (entry as { type?: unknown }).type;
        if (recordType !== "session_meta") {
          continue;
        }
        const payload = (entry as { payload?: unknown }).payload as
          | { id?: unknown; cwd?: unknown; timestamp?: unknown }
          | undefined;
        if (!payload || typeof payload.id !== "string" || typeof payload.cwd !== "string") {
          continue;
        }
        const timestamp =
          parseCodexTimestamp(
            typeof payload.timestamp === "string" || typeof payload.timestamp === "number"
              ? payload.timestamp
              : null,
          ) ??
          parseCodexTimestamp(
            typeof (entry as { timestamp?: unknown }).timestamp === "string" ||
              typeof (entry as { timestamp?: unknown }).timestamp === "number"
              ? (entry as { timestamp?: string | number }).timestamp
              : null,
          ) ??
          0;
        metas.set(payload.id, {
          providerSessionId: payload.id,
          project: payload.cwd,
          timestamp,
        });
        break;
      }
    }),
  );

  return metas;
}

async function loadCodexSessions(): Promise<SessionSnapshot[]> {
  const historyContent = await readTextFileIfExists(codexHistoryPath);
  const historyBySessionId = new Map<string, { lastMessage: string; timestamp: number }>();
  if (historyContent) {
    for (const entry of parseJsonLines(historyContent)) {
      const sid = typeof (entry as { session_id?: unknown }).session_id === "string"
        ? (entry as { session_id: string }).session_id
        : null;
      const text = typeof (entry as { text?: unknown }).text === "string"
        ? (entry as { text: string }).text
        : "";
      const ts = typeof (entry as { ts?: unknown }).ts === "number"
        ? (entry as { ts: number }).ts * 1000
        : null;
      if (!sid || ts === null) {
        continue;
      }
      const existing = historyBySessionId.get(sid);
      if (!existing || ts > existing.timestamp) {
        historyBySessionId.set(sid, {
          lastMessage: text,
          timestamp: ts,
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

async function buildWorktreeMap(projectPaths: string[]): Promise<Map<string, { name: string; branch: string }>> {
  const worktreeMap = new Map<string, { name: string; branch: string }>();
  for (const projectPath of projectPaths) {
    try {
      const worktrees = await listWorktrees(projectPath);
      for (const wt of worktrees) {
        worktreeMap.set(wt.path, {
          name: path.basename(wt.path),
          branch: wt.branch,
        });
      }
    } catch {
      // Skip paths that are not valid Git working trees.
    }
  }
  return worktreeMap;
}

export async function loadSessions(
  runtimeActiveSessions?: ReadonlyMap<string, RuntimeSessionInfo>,
): Promise<Session[]> {
  const activeSessions = runtimeActiveSessions ?? new Map<string, RuntimeSessionInfo>();
  const snapshots = [...(await loadClaudeSessions()), ...(await loadCodexSessions())];
  const worktreeMap = await buildWorktreeMap(
    Array.from(new Set(snapshots.map((snapshot) => snapshot.project))),
  );

  const sessions = snapshots.map((snapshot) => {
    const id = toSessionKey(snapshot.provider, snapshot.providerSessionId);
    let state: Session["state"];
    if (!fs.existsSync(snapshot.project)) {
      state = "archived";
    } else if (activeSessions.has(id)) {
      state = "active";
    } else {
      state = "inactive";
    }

    return {
      id,
      provider: snapshot.provider,
      providerSessionId: snapshot.providerSessionId,
      project: snapshot.project,
      projectName: path.basename(snapshot.project),
      repoPath: repoPathFromCwd(snapshot.project),
      lastMessage: snapshot.lastMessage,
      timestamp: snapshot.timestamp,
      state,
      worktree: worktreeMap.get(snapshot.project),
    } satisfies Session;
  });

  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}

export async function listCodexSessionIds(): Promise<Set<string>> {
  return new Set((await readCodexSessionMetas()).keys());
}

export async function findCodexSessionForLaunch(
  cwd: string,
  startedAt: number,
  existingSessionIds: ReadonlySet<string>,
): Promise<{ providerSessionId: string; timestamp: number } | null> {
  const metas = await readCodexSessionMetas();
  const matches = Array.from(metas.values())
    .filter(
      (meta) =>
        meta.project === cwd &&
        meta.timestamp >= startedAt - 2000 &&
        !existingSessionIds.has(meta.providerSessionId),
    )
    .sort((a, b) => b.timestamp - a.timestamp);

  const match = matches[0];
  return match
    ? { providerSessionId: match.providerSessionId, timestamp: match.timestamp }
    : null;
}
