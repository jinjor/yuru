import type { GitHubPullRequest } from "../shared/session.js";
import { recordAppWarning } from "./error-center.js";
import { toAppError } from "./errors.js";
import { exec } from "./exec.js";

interface TimedValue<T> {
  expiresAt: number;
  value: T;
}

// PR に加えて、その head コミットを持ち回る。ブランチ名の一致だけでは
// 「このブランチの PR」と確定できないため (toVisiblePullRequest を参照)。
export interface FetchedPullRequest {
  pullRequest: GitHubPullRequest;
  headRefOid: string;
}

// gh の存在・認証は滅多に変わらないので長めに覚える。gh auth status は
// GitHub API を叩くため、ポーリングのたびに確認するとそれ自体がリクエストになる。
const GH_STATUS_TTL_MS = 5 * 60_000;

let ghAvailableCache: TimedValue<boolean> | null = null;
let ghAuthenticatedCache: TimedValue<boolean> | null = null;
const repoSlugCache = new Map<string, string | null>();
// 最後に GitHub から取得できた branch -> PR。取得は PullRequestMonitor だけが行い、
// repo list の組み立てはここから読むだけ (GitHub へのリクエストは発生しない)。
const lastKnownPullRequestsByRepoPath = new Map<
  string,
  ReadonlyMap<string, FetchedPullRequest | null>
>();

function getCachedValue<T>(entry: TimedValue<T> | null): T | null {
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.value;
}

async function hasGhAvailable(cwd: string): Promise<boolean> {
  const cached = getCachedValue(ghAvailableCache);
  if (cached !== null) {
    return cached;
  }

  let value = false;
  try {
    await exec("gh", ["--version"], cwd);
    value = true;
  } catch {
    value = false;
  }

  ghAvailableCache = {
    value,
    expiresAt: Date.now() + GH_STATUS_TTL_MS,
  };
  return value;
}

async function hasGhAuthenticated(cwd: string): Promise<boolean> {
  const cached = getCachedValue(ghAuthenticatedCache);
  if (cached !== null) {
    return cached;
  }

  if (!(await hasGhAvailable(cwd))) {
    ghAuthenticatedCache = {
      value: false,
      expiresAt: Date.now() + GH_STATUS_TTL_MS,
    };
    return false;
  }

  let value = false;
  try {
    await exec("gh", ["auth", "status"], cwd);
    value = true;
  } catch {
    value = false;
  }

  ghAuthenticatedCache = {
    value,
    expiresAt: Date.now() + GH_STATUS_TTL_MS,
  };
  return value;
}

function parseGitHubRepoSlug(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function getRepoSlug(repoPath: string): Promise<string | null> {
  if (repoSlugCache.has(repoPath)) {
    return repoSlugCache.get(repoPath) ?? null;
  }

  let slug: string | null = null;
  try {
    const remoteUrl = await exec("git", ["remote", "get-url", "origin"], repoPath);
    slug = parseGitHubRepoSlug(remoteUrl);
  } catch {
    slug = null;
  }

  repoSlugCache.set(repoPath, slug);
  return slug;
}

// branch ごとの「最新の PR を 1 件」をエイリアスで束ねて 1 クエリにする。
// 何 branch 載せてもレート消費は 1 クエリ分 (実測でエイリアス 120 個まで cost 1)。
export function buildGitHubPullRequestQuery(repoSlug: string, branches: readonly string[]): string {
  const [owner, name] = repoSlug.split("/");
  const aliases = branches.map(
    (branch, index) =>
      `b${index}: pullRequests(headRefName: ${JSON.stringify(branch)}, first: 1, ` +
      `orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number state isDraft headRefOid url } }`,
  );
  return (
    `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) ` +
    `{ ${aliases.join(" ")} } }`
  );
}

function toFetchedPullRequest(node: unknown): FetchedPullRequest | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const pr = node as {
    number?: unknown;
    state?: unknown;
    isDraft?: unknown;
    headRefOid?: unknown;
    url?: unknown;
  };
  if (
    typeof pr.number !== "number" ||
    typeof pr.url !== "string" ||
    typeof pr.headRefOid !== "string"
  ) {
    return null;
  }

  let state: GitHubPullRequest["state"] | null = null;
  if (pr.state === "MERGED") {
    state = "merged";
  } else if (pr.state === "CLOSED") {
    state = "closed";
  } else if (pr.state === "OPEN") {
    state = pr.isDraft === true ? "draft" : "open";
  }
  if (!state) {
    return null;
  }

  return {
    pullRequest: {
      prNumber: pr.number,
      state,
      url: pr.url,
    },
    headRefOid: pr.headRefOid,
  };
}

export function parseGitHubPullRequestsResponse(
  raw: string,
  branches: readonly string[],
): Map<string, FetchedPullRequest | null> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const repository = (parsed as { data?: { repository?: unknown } })?.data?.repository;
  if (typeof repository !== "object" || repository === null) {
    return null;
  }

  const result = new Map<string, FetchedPullRequest | null>();
  for (const [index, branch] of branches.entries()) {
    const alias = (repository as Record<string, unknown>)[`b${index}`];
    const nodes = (alias as { nodes?: unknown })?.nodes;
    const first = Array.isArray(nodes) ? nodes[0] : null;
    result.set(branch, toFetchedPullRequest(first));
  }
  return result;
}

// ブランチ名は使い回されることがあるので、名前一致だけでは過去の PR を誤って拾う。
// open/draft は同名ブランチへの push で同じ PR が更新されるため名前一致で十分だが、
// merged/closed は PR の head コミットが worktree の head と一致するときだけこのブランチの PR とみなす。
export function toVisiblePullRequest(
  fetched: FetchedPullRequest | null,
  headSha: string,
): GitHubPullRequest | null {
  if (!fetched) {
    return null;
  }
  const { pullRequest, headRefOid } = fetched;
  if (pullRequest.state === "merged" || pullRequest.state === "closed") {
    return headRefOid === headSha ? pullRequest : null;
  }
  return pullRequest;
}

// 指定 branch 群の PR を GitHub から取得し、成功したら最終取得値を更新して返す。
// null は「取得しなかった/できなかった」(gh が使えない・GitHub リポジトリでない・通信失敗)。
// その場合、最終取得値は前のまま残る。
export async function fetchGitHubPullRequests(
  repoPath: string,
  branches: readonly string[],
): Promise<ReadonlyMap<string, FetchedPullRequest | null> | null> {
  const uniqueBranches = [...new Set(branches.filter((branch) => branch && branch !== "HEAD"))];
  if (!(await hasGhAuthenticated(repoPath))) {
    return null;
  }
  const repoSlug = await getRepoSlug(repoPath);
  if (!repoSlug) {
    return null;
  }

  if (uniqueBranches.length === 0) {
    const empty = new Map<string, FetchedPullRequest | null>();
    lastKnownPullRequestsByRepoPath.set(repoPath, empty);
    return empty;
  }

  let output: string;
  try {
    output = await exec(
      "gh",
      ["api", "graphql", "-f", `query=${buildGitHubPullRequestQuery(repoSlug, uniqueBranches)}`],
      repoPath,
    );
  } catch (error) {
    // gh が使える前提での失敗 (ネットワーク断など)。PR バッジは前回値のまま、記録は残す。
    recordAppWarning(toAppError(error, { command: "gh" }));
    return null;
  }

  const result = parseGitHubPullRequestsResponse(output, uniqueBranches);
  if (!result) {
    recordAppWarning({
      code: "command_failed",
      message: "Could not read the GitHub pull request response.",
      detail: `gh api graphql for ${repoSlug} returned an unexpected shape.`,
    });
    return null;
  }

  lastKnownPullRequestsByRepoPath.set(repoPath, result);
  return result;
}

// undefined は「この branch をまだ取得していない」、null は「PR が無い (または隠す)」。
export function getLastKnownGitHubPullRequest(
  repoPath: string,
  branch: string,
  headSha: string,
): GitHubPullRequest | null | undefined {
  const fetched = lastKnownPullRequestsByRepoPath.get(repoPath)?.get(branch);
  if (fetched === undefined) {
    return undefined;
  }
  return toVisiblePullRequest(fetched, headSha);
}
