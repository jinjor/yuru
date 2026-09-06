import os from "os";
import type { GitHubItem, GitHubPullRequest } from "../../shared/session.js";
import { recordAppWarning } from "../errors/center.js";
import { toAppError } from "../errors/app-error.js";
import { exec, execAllowingFailure } from "../exec.js";

interface TimedValue<T> {
  expiresAt: number;
  value: T;
}

// 監視する対象。branch は「その branch の最新 PR」、number は「その番号の Issue か PR」。
export type GitHubTarget =
  | { kind: "branch"; repoSlug: string; branch: string }
  | { kind: "number"; repoSlug: string; number: number };

// GitHub から取れた 1 件。status は renderer にそのまま渡す分で、残りは main だけが使う。
export interface FetchedGitHubItem {
  status: GitHubItem;
  title: string;
  // PR の head コミット。その branch の PR かどうかの判定に使う (toVisiblePullRequest を参照)。
  // issue は null。
  headRefOid: string | null;
}

// gh の存在・認証は滅多に変わらないので長めに覚える。gh auth status は
// GitHub API を叩くため、ポーリングのたびに確認するとそれ自体がリクエストになる。
const GH_STATUS_TTL_MS = 5 * 60_000;

let ghAvailableCache: TimedValue<boolean> | null = null;
let ghAuthenticatedCache: TimedValue<boolean> | null = null;
const repoSlugCache = new Map<string, string | null>();

function getCachedValue<T>(entry: TimedValue<T> | null): T | null {
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.value;
}

async function hasGhAvailable(): Promise<boolean> {
  const cached = getCachedValue(ghAvailableCache);
  if (cached !== null) {
    return cached;
  }

  let value = false;
  try {
    await exec("gh", ["--version"], os.homedir());
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

async function hasGhAuthenticated(): Promise<boolean> {
  const cached = getCachedValue(ghAuthenticatedCache);
  if (cached !== null) {
    return cached;
  }

  if (!(await hasGhAvailable())) {
    ghAuthenticatedCache = {
      value: false,
      expiresAt: Date.now() + GH_STATUS_TTL_MS,
    };
    return false;
  }

  let value = false;
  try {
    await exec("gh", ["auth", "status"], os.homedir());
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

export function parseGitHubRepoSlug(remoteUrl: string): string | null {
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

export async function getGitHubRepoSlug(repoPath: string): Promise<string | null> {
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

// GitHub の Issue / PR の URL を監視対象に変える。GitHub は issue と PR で番号の
// 名前空間が 1 つなので、/issues/ と /pull/ のどちらの URL でも同じ 1 件を指す。
// 種別は URL からは決められず、GitHub の応答で決まる。
export function parseGitHubItemUrl(url: string): GitHubTarget | null {
  const parsed = URL.parse(url);
  if (parsed?.hostname !== "github.com") {
    return null;
  }
  const match = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)\/?$/);
  return match ? { kind: "number", repoSlug: match[1], number: Number(match[2]) } : null;
}

// 同じ対象を 1 回だけ取るためのキー。repo 名の大小は GitHub 上で区別されないので揃える。
export function gitHubTargetKey(target: GitHubTarget): string {
  const repoSlug = target.repoSlug.toLowerCase();
  return target.kind === "branch" ? `${repoSlug}@${target.branch}` : `${repoSlug}#${target.number}`;
}

const ISSUE_FIELDS = "__typename number state title url";
const PULL_REQUEST_FIELDS = "__typename number state isDraft reviewDecision title url headRefOid";

function targetAlias(alias: string, target: GitHubTarget): string {
  if (target.kind === "branch") {
    return (
      `${alias}: pullRequests(headRefName: ${JSON.stringify(target.branch)}, first: 1, ` +
      `orderBy: {field: CREATED_AT, direction: DESC}) ` +
      `{ nodes { ${PULL_REQUEST_FIELDS} } }`
    );
  }
  return (
    `${alias}: issueOrPullRequest(number: ${target.number}) ` +
    `{ ... on Issue { ${ISSUE_FIELDS} } ... on PullRequest { ${PULL_REQUEST_FIELDS} } }`
  );
}

// 全 repository の全対象を 1 クエリに束ねる。repository をエイリアスで並べ、その中に
// 対象 1 件を 1 エイリアスで入れる。何件載せてもレート消費は 1 クエリ分
// (実測で 2 repository x 20 エイリアスでも cost 1)。
export function buildGitHubItemsQuery(
  targetsByRepoSlug: ReadonlyMap<string, readonly GitHubTarget[]>,
): string {
  const repositories = [...targetsByRepoSlug].map(([repoSlug, targets], repoIndex) => {
    const [owner, name] = repoSlug.split("/");
    const aliases = targets.map((target, index) => targetAlias(`t${index}`, target));
    return (
      `r${repoIndex}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) ` +
      `{ ${aliases.join(" ")} }`
    );
  });
  return `query { ${repositories.join(" ")} }`;
}

function toFetchedItem(node: unknown): FetchedGitHubItem | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const item = node as {
    __typename?: unknown;
    number?: unknown;
    state?: unknown;
    isDraft?: unknown;
    reviewDecision?: unknown;
    title?: unknown;
    url?: unknown;
    headRefOid?: unknown;
  };
  if (
    typeof item.number !== "number" ||
    typeof item.title !== "string" ||
    typeof item.url !== "string"
  ) {
    return null;
  }

  if (item.__typename === "Issue") {
    if (item.state !== "OPEN" && item.state !== "CLOSED") {
      return null;
    }
    return {
      status: {
        kind: "issue",
        number: item.number,
        state: item.state === "OPEN" ? "open" : "closed",
        url: item.url,
      },
      title: item.title,
      headRefOid: null,
    };
  }

  if (item.__typename !== "PullRequest" || typeof item.headRefOid !== "string") {
    return null;
  }
  let state: GitHubPullRequest["state"];
  if (item.state === "MERGED") {
    state = "merged";
  } else if (item.state === "CLOSED") {
    state = "closed";
  } else if (item.state === "OPEN") {
    state = item.isDraft === true ? "draft" : "open";
  } else {
    return null;
  }

  return {
    status: {
      kind: "pr",
      number: item.number,
      state,
      isApproved: item.reviewDecision === "APPROVED",
      url: item.url,
    },
    title: item.title,
    headRefOid: item.headRefOid,
  };
}

// 解決できた対象だけを返す。ある repository が解決できなかった (削除された・権限が
// 無くなったなど) 場合、その repository のエイリアスは null になるので、その分の対象は
// 結果に入らない = 今回は取得しなかった扱いになる。クエリ全体が失敗して data すら
// 取れないときは null。
export function parseGitHubItemsResponse(
  raw: string,
  targetsByRepoSlug: ReadonlyMap<string, readonly GitHubTarget[]>,
): Map<string, FetchedGitHubItem | null> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const data = (parsed as { data?: unknown })?.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const result = new Map<string, FetchedGitHubItem | null>();
  for (const [repoIndex, targets] of [...targetsByRepoSlug.values()].entries()) {
    const repository = (data as Record<string, unknown>)[`r${repoIndex}`];
    if (typeof repository !== "object" || repository === null) {
      continue;
    }
    for (const [index, target] of targets.entries()) {
      const alias = (repository as Record<string, unknown>)[`t${index}`];
      // branch は「最新の 1 件」の配列で、number は対象そのものが返る。
      const node =
        target.kind === "branch"
          ? ((alias as { nodes?: unknown })?.nodes as unknown[] | undefined)?.[0]
          : alias;
      result.set(gitHubTargetKey(target), toFetchedItem(node ?? null));
    }
  }
  return result;
}

// 全 repository の対象をまとめて 1 回で取る。返るのは解決できた対象だけで、
// 取れなかった分は前回値をそのまま使う。null は「今回は 1 件も取れなかった」
// (gh が使えない・認証切れ・通信失敗・応答が想定外)。
export async function fetchGitHubItems(
  targetsByRepoSlug: ReadonlyMap<string, readonly GitHubTarget[]>,
): Promise<ReadonlyMap<string, FetchedGitHubItem | null> | null> {
  if (targetsByRepoSlug.size === 0 || !(await hasGhAuthenticated())) {
    return null;
  }

  // gh api graphql は errors が 1 件でもあると非ゼロで終了するが、GraphQL は解決できた
  // 分を stdout に返す。1 つの repository が解決不能でも他のステータスは出したいので、
  // 終了コードではなく stdout の中身で成否を判断する。
  const { stdout, error } = await execAllowingFailure(
    "gh",
    ["api", "graphql", "-f", `query=${buildGitHubItemsQuery(targetsByRepoSlug)}`],
    os.homedir(),
  );

  const result = parseGitHubItemsResponse(stdout, targetsByRepoSlug);
  if (!result) {
    // 通信断や認証切れなど、クエリ全体の失敗。バッジは前回値のまま、記録は残す。
    recordAppWarning(
      error
        ? toAppError(error, { command: "gh" })
        : {
            code: "command_failed",
            message: "Could not read the GitHub response.",
            detail: "gh api graphql returned an unexpected shape.",
          },
    );
    return null;
  }
  if (error) {
    // 一部の repository だけが解決できなかった。取れた分は使い、理由は記録に残す。
    recordAppWarning(toAppError(error, { command: "gh" }));
  }
  return result;
}

// ブランチ名は使い回されることがあるので、名前一致だけでは過去の PR を誤って拾う。
// open/draft は同名ブランチへの push で同じ PR が更新されるため名前一致で十分だが、
// merged/closed は PR の head コミットが worktree の head と一致するときだけこのブランチの PR とみなす。
export function toVisiblePullRequest(
  fetched: FetchedGitHubItem | null,
  headSha: string,
): GitHubPullRequest | null {
  if (!fetched || fetched.status.kind !== "pr") {
    return null;
  }
  const { status, headRefOid } = fetched;
  if (status.state === "merged" || status.state === "closed") {
    return headRefOid === headSha ? status : null;
  }
  return status;
}
