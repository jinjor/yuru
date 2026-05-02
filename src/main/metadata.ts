import fs from "fs";
import os from "os";
import path from "path";
import type {
  PrimarySessionMetadata,
  RepoListItem,
  RepoMetadata,
  TaskWorktreeListItem,
  TaskWorktreeMetadata,
  YuruMetadata,
} from "../shared/metadata.js";
import type { SessionProvider } from "../shared/session.js";

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

export function loadRepoList(): RepoListItem[] {
  const metadata = loadMetadata();
  const taskWorktreesByRepoId = new Map<string, TaskWorktreeListItem[]>();
  for (const taskWorktree of metadata.taskWorktrees) {
    const entries = taskWorktreesByRepoId.get(taskWorktree.repoId) ?? [];
    entries.push({
      taskWorktreeId: taskWorktree.taskWorktreeId,
      worktreePath: taskWorktree.worktreePath,
      name: path.basename(taskWorktree.worktreePath),
      primarySession: taskWorktree.primarySession,
      suggestedSessions: [],
    });
    taskWorktreesByRepoId.set(taskWorktree.repoId, entries);
  }

  return metadata.repos.map((repo) => ({
    ...repo,
    taskWorktrees: taskWorktreesByRepoId.get(repo.id) ?? [],
  }));
}

export function loadTaskWorktrees(): TaskWorktreeMetadata[] {
  return loadMetadata().taskWorktrees;
}

export function findRepoByPath(repoPath: string): RepoMetadata | null {
  return loadRepos().find((repo) => repo.repoPath === repoPath) ?? null;
}

export function upsertTaskWorktree(
  taskWorktreeId: string,
  repoId: string,
  worktreePath: string,
): void {
  const metadata = loadMetadata();
  const existing = metadata.taskWorktrees.find((entry) => entry.taskWorktreeId === taskWorktreeId);
  if (existing) {
    existing.repoId = repoId;
    existing.worktreePath = worktreePath;
  } else {
    metadata.taskWorktrees.push({ taskWorktreeId, repoId, worktreePath });
  }
  saveMetadata(metadata);
}

export function attachPrimarySession(
  taskWorktreeId: string,
  primary: PrimarySessionMetadata,
): void {
  const metadata = loadMetadata();
  const target = metadata.taskWorktrees.find((entry) => entry.taskWorktreeId === taskWorktreeId);
  if (!target) {
    return;
  }
  for (const entry of metadata.taskWorktrees) {
    if (
      entry !== target &&
      entry.primarySession &&
      entry.primarySession.provider === primary.provider &&
      entry.primarySession.providerSessionId === primary.providerSessionId
    ) {
      delete entry.primarySession;
    }
  }
  target.primarySession = primary;
  saveMetadata(metadata);
}

export function removeTaskWorktreeByPath(worktreePath: string): void {
  const metadata = loadMetadata();
  const next = metadata.taskWorktrees.filter((entry) => entry.worktreePath !== worktreePath);
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
    taskWorktreeId?: unknown;
    repoId?: unknown;
    worktreePath?: unknown;
    primarySession?: unknown;
  };
  if (
    typeof maybe.taskWorktreeId !== "string" ||
    typeof maybe.repoId !== "string" ||
    typeof maybe.worktreePath !== "string"
  ) {
    throw new Error(
      "Yuru metadata taskWorktree entries must have string taskWorktreeId, repoId, worktreePath.",
    );
  }
  const entry: TaskWorktreeMetadata = {
    taskWorktreeId: maybe.taskWorktreeId,
    repoId: maybe.repoId,
    worktreePath: maybe.worktreePath,
  };
  if (maybe.primarySession !== undefined) {
    entry.primarySession = parsePrimarySession(maybe.primarySession);
  }
  return entry;
}

function parsePrimarySession(value: unknown): PrimarySessionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata primarySession must be an object.");
  }
  const maybe = value as { provider?: unknown; providerSessionId?: unknown };
  if (
    (maybe.provider !== "claude" && maybe.provider !== "codex") ||
    typeof maybe.providerSessionId !== "string"
  ) {
    throw new Error(
      "Yuru metadata primarySession must have provider claude|codex and string providerSessionId.",
    );
  }
  return {
    provider: maybe.provider as SessionProvider,
    providerSessionId: maybe.providerSessionId,
  };
}

function saveMetadata(metadata: YuruMetadata): void {
  const metadataPath = getMetadataPath();
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function getYuruHome(): string {
  return process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
}

function getMetadataPath(): string {
  return process.env.YURU_METADATA_PATH ?? path.join(getYuruHome(), "metadata.json");
}
