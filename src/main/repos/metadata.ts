import fs from "fs";
import path from "path";
import type {
  PrimarySessionMetadata,
  RepoMetadata,
  TaskWorktreeMetadata,
  YuruMetadata,
} from "../../shared/metadata.js";
import { SESSION_PROVIDER_IDS, toSessionKey, type SessionProvider } from "../../shared/session.js";
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

// 送られた ID の順をそのまま repo の並びとして書く。送られなかった repo (一覧を取ってから
// 並び替えるまでの間に壊れた・追加されたもの) は末尾にそのまま残す。壊れた repo の掃除は
// 起動時の cleanupBrokenRepos の仕事で、並び替えは何も消さない。
export function saveRepoOrder(repoIds: readonly string[]): void {
  const metadata = loadMetadata();
  const sentRepoIds = new Set(repoIds);

  metadata.repos = [
    ...repoIds
      .map((repoId) => metadata.repos.find((repo) => repo.id === repoId))
      .filter((repo) => repo !== undefined),
    ...metadata.repos.filter((repo) => !sentRepoIds.has(repo.id)),
  ];
  saveMetadata(metadata);
}

// 送られた path の順をその repo の task worktree の表示順として書く。ここは並びだけを
// 持ち、worktree の実体は Git 側が持つ。実在しない path は読み出し時 (repo-list) に
// 捨てられるので、worktree を消した後の掃除は要らない。
export function saveWorktreeOrder(repoId: string, worktreePaths: readonly string[]): void {
  const metadata = loadMetadata();
  const repo = metadata.repos.find((entry) => entry.id === repoId);
  if (!repo) {
    throw new Error(`Yuru metadata has no repo with id "${repoId}".`);
  }
  repo.worktreeOrder = [...worktreePaths];
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

// 送られた key の順をその worktree の primary session の並びとして書く。今ある session と
// 顔ぶれが同じ時だけ書き、違うなら、ドラッグ中に session が増減した古い一覧から来た並びで、
// 他の変更を巻き込んで上書きしてしまうため、何も書かずに false を返す。
export function savePrimarySessionOrder(
  worktreePath: string,
  agentSessionKeys: readonly string[],
): boolean {
  const metadata = loadMetadata();
  const worktreePathKey = toWorktreePathKey(worktreePath);
  const target = metadata.taskWorktrees.find(
    (entry) => toWorktreePathKey(entry.worktreePath) === worktreePathKey,
  );
  if (!target) {
    return false;
  }
  const sessionsByKey = new Map(
    target.primarySessions.map((session) => [
      toSessionKey(session.provider, session.agentSessionId),
      session,
    ]),
  );
  const nextPrimarySessions = agentSessionKeys
    .map((agentSessionKey) => sessionsByKey.get(agentSessionKey))
    .filter((session) => session !== undefined);
  // 今ある session に無い key が混ざっていれば 1 つ目で、数が足りない・重複していれば
  // 2 つ目で落ちる。両方を通るのは顔ぶれが同じ時だけ。
  if (
    nextPrimarySessions.length !== agentSessionKeys.length ||
    new Set(agentSessionKeys).size !== sessionsByKey.size
  ) {
    return false;
  }
  target.primarySessions = nextPrimarySessions;
  saveMetadata(metadata);
  return true;
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
  const maybe = value as { id?: unknown; repoPath?: unknown; worktreeOrder?: unknown };
  if (typeof maybe.id !== "string" || typeof maybe.repoPath !== "string") {
    throw new Error("Yuru metadata repo entries must have string id and repoPath.");
  }
  const repo: RepoMetadata = { id: maybe.id, repoPath: maybe.repoPath };
  if (maybe.worktreeOrder !== undefined) {
    if (
      !Array.isArray(maybe.worktreeOrder) ||
      maybe.worktreeOrder.some((worktreePath) => typeof worktreePath !== "string")
    ) {
      throw new Error("Yuru metadata repo worktreeOrder must be an array of strings.");
    }
    repo.worktreeOrder = maybe.worktreeOrder;
  }
  return repo;
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
