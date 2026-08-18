import fs from "fs";
import path from "path";
import type {
  PrimarySessionMetadata,
  RepoMetadata,
  TaskWorktreeMetadata,
  YuruMetadata,
} from "../../shared/metadata.js";
import { SESSION_PROVIDER_IDS, type SessionProvider } from "../../shared/session.js";
import { toWorktreePathKey } from "../worktree-identity.js";
import { getYuruHome } from "../yuru-home.js";

export function loadMetadata(): YuruMetadata {
  const metadataPath = getMetadataPath();
  if (!fs.existsSync(metadataPath)) {
    return { repos: [], taskWorktrees: [] };
  }
  return parseMetadata(JSON.parse(fs.readFileSync(metadataPath, "utf8")));
}

export function loadRepos(): RepoMetadata[] {
  return loadMetadata().repos;
}

export function loadTaskWorktrees(): TaskWorktreeMetadata[] {
  return loadMetadata().taskWorktrees;
}

export function findRepoByPath(repoPath: string): RepoMetadata | null {
  return loadRepos().find((repo) => repo.repoPath === repoPath) ?? null;
}

// 送られた ID の順をそのまま repo の並びとして書く。renderer は一覧の全 repo を送るので、
// 含まれない entry は一覧から落ちた repo (Git repository でなくなったもの) で、その task
// worktree record ごと消える。
export function saveRepoOrder(repoIds: readonly string[]): void {
  const metadata = loadMetadata();
  const nextRepos = repoIds
    .map((repoId) => metadata.repos.find((repo) => repo.id === repoId))
    .filter((repo) => repo !== undefined);
  const nextRepoIds = new Set(nextRepos.map((repo) => repo.id));
  const removedRepoIds = new Set(
    metadata.repos.map((repo) => repo.id).filter((repoId) => !nextRepoIds.has(repoId)),
  );

  metadata.repos = nextRepos;
  metadata.taskWorktrees = metadata.taskWorktrees.filter(
    (entry) => !removedRepoIds.has(entry.repoId),
  );
  saveMetadata(metadata);
}

export function upsertTaskWorktree(repoId: string, worktreePath: string): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const existing = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (existing) {
    existing.repoId = repoId;
    existing.worktreePath = worktreePath;
  } else {
    metadata.taskWorktrees.push({ repoId, worktreePath, primarySessions: [] });
  }
  saveMetadata(metadata);
}

export function attachPrimarySessionByPath(
  worktreePath: string,
  primary: PrimarySessionMetadata,
): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const target = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (!target) {
    return;
  }
  for (const entry of metadata.taskWorktrees) {
    if (entry !== target) {
      entry.primarySessions = entry.primarySessions.filter(
        (session) => !samePrimarySession(session, primary),
      );
    }
  }
  if (!target.primarySessions.some((session) => samePrimarySession(session, primary))) {
    target.primarySessions.push(primary);
  }
  saveMetadata(metadata);
}

export function detachPrimarySessionByPath(
  worktreePath: string,
  primary: PrimarySessionMetadata,
): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const target = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (!target) {
    return;
  }

  const primarySessions = target.primarySessions.filter(
    (session) => !samePrimarySession(session, primary),
  );
  if (primarySessions.length === target.primarySessions.length) {
    return;
  }
  target.primarySessions = primarySessions;
  saveMetadata(metadata);
}

function samePrimarySession(a: PrimarySessionMetadata, b: PrimarySessionMetadata): boolean {
  return a.provider === b.provider && a.agentSessionId === b.agentSessionId;
}

export function removeTaskWorktreeByPath(worktreePath: string): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const next = metadata.taskWorktrees.filter(
    (entry) => toWorktreePathKey(entry.worktreePath) !== worktreePathKey,
  );
  if (next.length === metadata.taskWorktrees.length) {
    return;
  }
  metadata.taskWorktrees = next;
  saveMetadata(metadata);
}

export function parseMetadata(value: unknown): YuruMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata must be a JSON object.");
  }
  const maybe = value as { repos?: unknown; taskWorktrees?: unknown };
  return {
    repos: parseRepos(maybe.repos),
    taskWorktrees: parseTaskWorktrees(maybe.taskWorktrees),
  };
}

function parseRepos(value: unknown): RepoMetadata[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Yuru metadata `repos` must be an array.");
  }
  return value.map(parseRepo);
}

function parseRepo(value: unknown): RepoMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata repo entries must be objects.");
  }
  const maybe = value as { id?: unknown; repoPath?: unknown };
  if (typeof maybe.id !== "string" || typeof maybe.repoPath !== "string") {
    throw new Error("Yuru metadata repo entries must have string id and repoPath.");
  }
  return { id: maybe.id, repoPath: maybe.repoPath };
}

function parseTaskWorktrees(value: unknown): TaskWorktreeMetadata[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Yuru metadata `taskWorktrees` must be an array.");
  }
  return value.map(parseTaskWorktree);
}

function parseTaskWorktree(value: unknown): TaskWorktreeMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata taskWorktree entries must be objects.");
  }
  const maybe = value as {
    repoId?: unknown;
    worktreePath?: unknown;
    primarySessions?: unknown;
    primarySession?: unknown;
  };
  if (typeof maybe.repoId !== "string" || typeof maybe.worktreePath !== "string") {
    throw new Error("Yuru metadata taskWorktree entries must have string repoId and worktreePath.");
  }
  const entry: TaskWorktreeMetadata = {
    repoId: maybe.repoId,
    worktreePath: maybe.worktreePath,
    primarySessions: [],
  };
  if (maybe.primarySessions !== undefined) {
    if (!Array.isArray(maybe.primarySessions)) {
      throw new Error("Yuru metadata taskWorktree primarySessions must be an array.");
    }
    entry.primarySessions = maybe.primarySessions.map(parsePrimarySession);
  } else if (maybe.primarySession !== undefined) {
    entry.primarySessions = [parsePrimarySession(maybe.primarySession)];
  }
  return entry;
}

function parsePrimarySession(value: unknown): PrimarySessionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata primarySession must be an object.");
  }
  const maybe = value as {
    provider?: unknown;
    agentSessionId?: unknown;
    providerSessionId?: unknown;
    cwd?: unknown;
  };
  // 旧 schema の providerSessionId は読み込み時に agentSessionId として扱い、
  // 以後の書き込みは agentSessionId だけを使う。
  const agentSessionId = maybe.agentSessionId ?? maybe.providerSessionId;
  if (
    !SESSION_PROVIDER_IDS.includes(maybe.provider as SessionProvider) ||
    typeof agentSessionId !== "string"
  ) {
    throw new Error(
      `Yuru metadata primarySession must have provider ${SESSION_PROVIDER_IDS.join("|")} and string agentSessionId.`,
    );
  }
  if (maybe.cwd !== undefined && typeof maybe.cwd !== "string") {
    throw new Error("Yuru metadata primarySession cwd must be a string.");
  }
  const primarySession: PrimarySessionMetadata = {
    provider: maybe.provider as SessionProvider,
    agentSessionId,
  };
  if (maybe.cwd !== undefined) {
    primarySession.cwd = maybe.cwd;
  }
  return primarySession;
}

export function saveMetadata(metadata: YuruMetadata): void {
  const metadataPath = getMetadataPath();
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function getMetadataPath(): string {
  return process.env.YURU_METADATA_PATH ?? path.join(getYuruHome(), "metadata.json");
}
