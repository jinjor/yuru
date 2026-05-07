import fs from "fs";
import os from "os";
import path from "path";
import type {
  PrimarySessionMetadata,
  RepoListItem,
  RepoMetadata,
  SuggestedSessionListItem,
  TaskWorktreeListItem,
  TaskWorktreeMetadata,
  YuruMetadata,
} from "../shared/metadata.js";
import {
  toSessionKey,
  type RuntimeSessionId,
  type SessionProvider,
  type SuggestedWorktreeSession,
} from "../shared/session.js";
import { listWorktrees, type WorktreeInfo } from "./git.js";

type ListWorktrees = (repoPath: string) => Promise<readonly WorktreeInfo[]>;
type LoadSuggestedSessions = (
  worktreePaths: readonly string[],
) => Promise<ReadonlyMap<string, readonly SuggestedWorktreeSession[]>>;

export interface ActiveRuntimeSessionListItem {
  runtimeSessionId: RuntimeSessionId;
  provider: SessionProvider;
  providerSessionId: string | null;
}

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

export async function loadRepoList(
  activeRuntimeSessionIdsByKey?: ReadonlyMap<string, RuntimeSessionId>,
  listGitWorktrees: ListWorktrees = listWorktrees,
  primarySessionPreviewsByKey?: ReadonlyMap<string, string>,
  activeRuntimeSessionsByWorktreePath?: ReadonlyMap<string, ActiveRuntimeSessionListItem>,
  loadSuggestedSessions?: LoadSuggestedSessions,
): Promise<RepoListItem[]> {
  const metadata = loadMetadata();
  const repoEntries = await Promise.all(
    metadata.repos.map(async (repo) => {
      // TODO: repo の存在確認。存在しない repo は返さない。
      const metadataByPath = new Map(
        metadata.taskWorktrees
          .filter((taskWorktree) => taskWorktree.repoId === repo.id)
          .map((taskWorktree) => [toWorktreePathKey(taskWorktree.worktreePath), taskWorktree]),
      );
      const gitWorktrees = await loadGitWorktrees(repo.repoPath, listGitWorktrees);
      return { repo, metadataByPath, gitWorktrees };
    }),
  );
  const worktreePaths = repoEntries.flatMap((entry) =>
    entry.gitWorktrees.map((gitWorktree) => gitWorktree.path),
  );
  const suggestedSessionsByWorktreePath = loadSuggestedSessions
    ? await loadSuggestedSessions(worktreePaths)
    : undefined;

  return repoEntries.map(({ repo, metadataByPath, gitWorktrees }) => {
    const taskWorktrees = gitWorktrees.map((gitWorktree) =>
      toTaskWorktreeListItem(
        repo.id,
        gitWorktree.path,
        metadataByPath.get(toWorktreePathKey(gitWorktree.path)),
        activeRuntimeSessionIdsByKey,
        primarySessionPreviewsByKey,
        activeRuntimeSessionsByWorktreePath,
        suggestedSessionsByWorktreePath?.get(gitWorktree.path) ?? [],
      ),
    );

    return {
      ...repo,
      taskWorktrees,
    };
  });
}

export function loadTaskWorktrees(): TaskWorktreeMetadata[] {
  return loadMetadata().taskWorktrees;
}

export function findRepoByPath(repoPath: string): RepoMetadata | null {
  return loadRepos().find((repo) => repo.repoPath === repoPath) ?? null;
}

export function upsertTaskWorktree(
  repoId: string,
  worktreePath: string,
): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const existing = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (existing) {
    existing.repoId = repoId;
    existing.worktreePath = worktreePath;
  } else {
    metadata.taskWorktrees.push({ repoId, worktreePath });
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

export function detachPrimarySessionByPath(
  worktreePath: string,
  primary: PrimarySessionMetadata,
): void {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const target = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (
    !target?.primarySession ||
    target.primarySession.provider !== primary.provider ||
    target.primarySession.providerSessionId !== primary.providerSessionId
  ) {
    return;
  }

  delete target.primarySession;
  saveMetadata(metadata);
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
    primarySession?: unknown;
  };
  if (
    typeof maybe.repoId !== "string" ||
    typeof maybe.worktreePath !== "string"
  ) {
    throw new Error(
      "Yuru metadata taskWorktree entries must have string repoId and worktreePath.",
    );
  }
  const entry: TaskWorktreeMetadata = {
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

async function loadGitWorktrees(
  repoPath: string,
  listGitWorktrees: ListWorktrees,
): Promise<readonly WorktreeInfo[]> {
  try {
    return await listGitWorktrees(repoPath);
  } catch {
    return [];
  }
}

function toTaskWorktreeListItem(
  repoId: string,
  worktreePath: string,
  metadataEntry: TaskWorktreeMetadata | undefined,
  activeRuntimeSessionIdsByKey: ReadonlyMap<string, RuntimeSessionId> | undefined,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
  activeRuntimeSessionsByWorktreePath: ReadonlyMap<string, ActiveRuntimeSessionListItem> | undefined,
  suggestedSessions: readonly SuggestedWorktreeSession[],
): TaskWorktreeListItem {
  const worktreeId = toWorktreeId(repoId, worktreePath);
  const primarySession = metadataEntry?.primarySession;
  const primarySessionKey = primarySession
    ? toSessionKey(primarySession.provider, primarySession.providerSessionId)
    : null;
  const activeRuntimeSessionId = primarySessionKey
    ? activeRuntimeSessionIdsByKey?.get(primarySessionKey) ?? null
    : null;
  const activeRuntimeSession = activeRuntimeSessionsByWorktreePath?.get(
    toWorktreePathKey(worktreePath),
  );
  const activeRuntimeSessionKey = activeRuntimeSession?.providerSessionId
    ? toSessionKey(activeRuntimeSession.provider, activeRuntimeSession.providerSessionId)
    : null;
  const suggestedSessionItems = toSuggestedSessionListItems(
    suggestedSessions,
    new Set([primarySessionKey, activeRuntimeSessionKey].filter((key) => key !== null)),
    primarySessionPreviewsByKey,
  );

  return {
    worktreeId,
    worktreePath,
    name: path.basename(worktreePath),
    primarySession: primarySession && primarySessionKey
      ? {
          provider: primarySession.provider,
          providerSessionKey: primarySessionKey,
          activeRuntimeSessionId,
          state: activeRuntimeSessionId ? "active" : "inactive",
          preview: primarySessionPreviewsByKey?.get(primarySessionKey) ?? "",
        }
      : activeRuntimeSession
        ? {
            provider: activeRuntimeSession.provider,
            providerSessionKey: activeRuntimeSessionKey,
            activeRuntimeSessionId: activeRuntimeSession.runtimeSessionId,
            state: "active",
            preview: activeRuntimeSessionKey
              ? primarySessionPreviewsByKey?.get(activeRuntimeSessionKey) ?? ""
              : "",
          }
      : undefined,
    suggestedSessions: suggestedSessionItems,
  };
}

function toSuggestedSessionListItems(
  suggestedSessions: readonly SuggestedWorktreeSession[],
  excludedSessionKeys: ReadonlySet<string>,
  primarySessionPreviewsByKey: ReadonlyMap<string, string> | undefined,
): SuggestedSessionListItem[] {
  return suggestedSessions.flatMap((session) => {
    const providerSessionKey = toSessionKey(session.provider, session.providerSessionId);
    if (excludedSessionKeys.has(providerSessionKey)) {
      return [];
    }
    return [
      {
        provider: session.provider,
        providerSessionKey,
        preview: primarySessionPreviewsByKey?.get(providerSessionKey) ?? "",
      },
    ];
  });
}

function toWorktreePathKey(worktreePath: string): string {
  return path.resolve(worktreePath);
}

export function toWorktreeId(repoId: string, worktreePath: string): string {
  return `worktree:${repoId}:${worktreePath}`;
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
