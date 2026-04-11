import { GitHubPullRequest } from "../shared/session.js";
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
const pullRequestCache = new Map<string, TimedValue<GitHubPullRequest | null>>();

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

function parsePullRequest(raw: string): GitHubPullRequest | null {
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
    mergedAt?: unknown;
    url?: unknown;
  };

  if (typeof first.number !== "number") {
    return null;
  }

  let state: GitHubPullRequest["state"] | null = null;
  if (first.mergedAt) {
    state = "merged";
  } else if (typeof first.state === "string") {
    const normalized = first.state.toLowerCase();
    if (normalized === "open" || normalized === "closed" || normalized === "merged") {
      state = normalized;
    }
  }

  if (!state) {
    return null;
  }

  return {
    prNumber: first.number,
    state,
    url: typeof first.url === "string" ? first.url : undefined,
  };
}

export async function getGitHubPullRequestForBranch(
  repoPath: string,
  branch: string | null,
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
    return cached.value;
  }

  let value: GitHubPullRequest | null = null;
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
        "number,state,mergedAt,url",
      ],
      repoPath,
    );
    value = parsePullRequest(output);
  } catch {
    value = null;
  }

  pullRequestCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + PR_CACHE_TTL_MS,
  });
  return value;
}
