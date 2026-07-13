import type { GitHubPullRequest } from "../shared/session.js";
import { recordAppWarning } from "./error-center.js";
import { toAppError } from "./errors.js";
import { exec } from "./exec.js";

interface TimedValue<T> {
  expiresAt: number;
  value: T;
}

const GH_STATUS_TTL_MS = 30_000;
const PR_CACHE_TTL_MS = 15_000;

let ghAvailableCache: TimedValue<boolean> | null = null;
let ghAuthenticatedCache: TimedValue<boolean> | null = null;
const repoSlugCache = new Map<string, string | null>();
const pullRequestCache = new Map<string, TimedValue<FetchedPullRequest | null>>();

interface FetchedPullRequest {
  pullRequest: GitHubPullRequest;
  headRefOid: string;
}

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

function parsePullRequest(raw: string): FetchedPullRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const first = parsed[0] as {
    number?: unknown;
    state?: unknown;
    isDraft?: unknown;
    mergedAt?: unknown;
    headRefOid?: unknown;
    url: unknown;
  };

  if (
    typeof first.number !== "number" ||
    typeof first.url !== "string" ||
    typeof first.headRefOid !== "string"
  ) {
    return null;
  }

  let state: GitHubPullRequest["state"] | null = null;
  if (first.mergedAt) {
    state = "merged";
  } else if (typeof first.state === "string") {
    const normalized = first.state.toLowerCase();
    if (normalized === "open") {
      state = first.isDraft === true ? "draft" : "open";
    } else if (normalized === "closed" || normalized === "merged") {
      state = normalized;
    }
  }

  if (!state) {
    return null;
  }

  return {
    pullRequest: {
      prNumber: first.number,
      state,
      url: first.url,
    },
    headRefOid: first.headRefOid,
  };
}

// ブランチ名は使い回されることがあるので、名前一致だけでは過去の PR を誤って拾う。
// open/draft は同名ブランチへの push で同じ PR が更新されるため名前一致で十分だが、
// merged/closed は PR の head コミットが worktree の head と一致するときだけこのブランチの PR とみなす。
function toVisiblePullRequest(
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

export async function getGitHubPullRequestForBranch(
  repoPath: string,
  branch: string | null,
  headSha: string,
): Promise<GitHubPullRequest | null> {
  if (!branch || branch === "HEAD") {
    return null;
  }
  if (!(await hasGhAuthenticated(repoPath))) {
    return null;
  }

  const repoSlug = await getRepoSlug(repoPath);
  if (!repoSlug) {
    return null;
  }

  const cacheKey = `${repoSlug}:${branch}`;
  const cached = pullRequestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return toVisiblePullRequest(cached.value, headSha);
  }

  let value: FetchedPullRequest | null = null;
  try {
    const output = await exec(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "number,state,isDraft,mergedAt,headRefOid,url",
      ],
      repoPath,
    );
    value = parsePullRequest(output);
  } catch (error) {
    // gh が使える前提での失敗 (ネットワーク断など)。PR バッジは出せないが記録は残す。
    recordAppWarning(toAppError(error, { command: "gh" }));
    value = null;
  }

  pullRequestCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + PR_CACHE_TTL_MS,
  });
  return toVisiblePullRequest(value, headSha);
}
