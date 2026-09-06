import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitHubItemsQuery,
  gitHubTargetKey,
  parseGitHubItemUrl,
  parseGitHubItemsResponse,
  parseGitHubRepoSlug,
  toVisiblePullRequest,
} from "../../../src/main/github/github.ts";

const branchTarget = (branch) => ({ kind: "branch", repoSlug: "jinjor/yuru", branch });
const numberTarget = (number) => ({ kind: "number", repoSlug: "jinjor/yuru", number });

function pullRequestNode(overrides) {
  return {
    __typename: "PullRequest",
    number: 1,
    state: "OPEN",
    isDraft: false,
    reviewDecision: null,
    title: "Add a thing",
    url: "https://example.com/1",
    headRefOid: "sha-1",
    ...overrides,
  };
}

test("parseGitHubRepoSlug は GitHub の origin URL から owner/repository を取り出す", () => {
  for (const remoteUrl of [
    "git@github.com:jinjor/yuru.git",
    "https://github.com/jinjor/yuru.git",
    "ssh://git@github.com/jinjor/yuru.git",
  ]) {
    assert.equal(parseGitHubRepoSlug(remoteUrl), "jinjor/yuru");
  }
  assert.equal(parseGitHubRepoSlug("https://gitlab.com/jinjor/yuru.git"), null);
});

test("parseGitHubItemUrl は issue / pull のどちらの URL も同じ番号の対象にする", () => {
  assert.deepEqual(parseGitHubItemUrl("https://github.com/jinjor/yuru/issues/71"), {
    kind: "number",
    repoSlug: "jinjor/yuru",
    number: 71,
  });
  assert.deepEqual(parseGitHubItemUrl("https://github.com/jinjor/yuru/pull/71/"), {
    kind: "number",
    repoSlug: "jinjor/yuru",
    number: 71,
  });
  assert.deepEqual(parseGitHubItemUrl("https://github.com/jinjor/yuru/issues/71?x=1#y"), {
    kind: "number",
    repoSlug: "jinjor/yuru",
    number: 71,
  });
});

test("parseGitHubItemUrl は issue / pull 以外や GitHub 以外の URL を弾く", () => {
  assert.equal(parseGitHubItemUrl("https://github.com/jinjor/yuru"), null);
  assert.equal(parseGitHubItemUrl("https://github.com/jinjor/yuru/discussions/3"), null);
  assert.equal(parseGitHubItemUrl("https://github.com/jinjor/yuru/blob/main/README.md"), null);
  assert.equal(parseGitHubItemUrl("https://github.com/jinjor/yuru/pull/72/files?diff=split"), null);
  assert.equal(parseGitHubItemUrl("https://example.com/jinjor/yuru/issues/71"), null);
  assert.equal(parseGitHubItemUrl("https://github.com/jinjor/yuru/issues/abc"), null);
  assert.equal(parseGitHubItemUrl("not a url"), null);
});

test("gitHubTargetKey は repository 名の大小を無視して同じ対象を同じキーにする", () => {
  assert.equal(
    gitHubTargetKey({ kind: "number", repoSlug: "Jinjor/Yuru", number: 7 }),
    gitHubTargetKey(numberTarget(7)),
  );
  assert.notEqual(gitHubTargetKey(numberTarget(7)), gitHubTargetKey(branchTarget("7")));
});

test("buildGitHubItemsQuery は branch と番号のエイリアスを 1 クエリに束ねる", () => {
  const query = buildGitHubItemsQuery(
    new Map([["jinjor/yuru", [branchTarget("feature-a"), numberTarget(71)]]]),
  );
  assert.match(query, /r0: repository\(owner: "jinjor", name: "yuru"\)/);
  assert.match(query, /t0: pullRequests\(headRefName: "feature-a", first: 1/);
  assert.match(query, /orderBy: \{field: CREATED_AT, direction: DESC\}/);
  assert.match(query, /t1: issueOrPullRequest\(number: 71\)/);
  assert.match(query, /\.\.\. on Issue \{ __typename number state title url \}/);
});

test("buildGitHubItemsQuery は repository を跨いでも 1 クエリに束ねる", () => {
  const query = buildGitHubItemsQuery(
    new Map([
      ["jinjor/yuru", [numberTarget(71)]],
      ["cli/cli", [{ kind: "number", repoSlug: "cli/cli", number: 900 }]],
    ]),
  );
  assert.match(query, /^query \{ r0: repository\(owner: "jinjor", name: "yuru"\) /);
  assert.match(query, /r1: repository\(owner: "cli", name: "cli"\) \{ t0: issueOrPullRequest/);
});

test("buildGitHubItemsQuery は branch 名の引用符をエスケープする", () => {
  const query = buildGitHubItemsQuery(new Map([["jinjor/yuru", [branchTarget('a"b')]]]));
  assert.match(query, /headRefName: "a\\"b"/);
});

test("parseGitHubItemsResponse は state と isDraft を PR の状態へ写す", () => {
  const targets = [
    branchTarget("a"),
    branchTarget("b"),
    branchTarget("c"),
    branchTarget("d"),
    branchTarget("e"),
  ];
  const raw = JSON.stringify({
    data: {
      r0: {
        t0: { nodes: [pullRequestNode({ reviewDecision: "APPROVED" })] },
        t1: { nodes: [pullRequestNode({ number: 2, isDraft: true, headRefOid: "sha-2" })] },
        t2: {
          nodes: [
            pullRequestNode({
              number: 3,
              state: "MERGED",
              reviewDecision: "APPROVED",
              headRefOid: "sha-3",
            }),
          ],
        },
        t3: {
          nodes: [
            pullRequestNode({
              number: 4,
              state: "CLOSED",
              reviewDecision: "CHANGES_REQUESTED",
              headRefOid: "sha-4",
            }),
          ],
        },
        t4: { nodes: [] },
      },
    },
  });
  const result = parseGitHubItemsResponse(raw, new Map([["jinjor/yuru", targets]]));
  assert.deepEqual(result.get(gitHubTargetKey(targets[0])), {
    status: { kind: "pr", number: 1, state: "open", isApproved: true, url: "https://example.com/1" },
    title: "Add a thing",
    headRefOid: "sha-1",
  });
  assert.equal(result.get(gitHubTargetKey(targets[1])).status.state, "draft");
  assert.equal(result.get(gitHubTargetKey(targets[2])).status.state, "merged");
  assert.equal(result.get(gitHubTargetKey(targets[3])).status.state, "closed");
  assert.equal(result.get(gitHubTargetKey(targets[3])).status.isApproved, false);
  assert.equal(result.get(gitHubTargetKey(targets[4])), null);
});

test("parseGitHubItemsResponse は種別を __typename で決める", () => {
  const targets = [numberTarget(71), numberTarget(72)];
  const raw = JSON.stringify({
    data: {
      r0: {
        t0: {
          __typename: "Issue",
          number: 71,
          state: "CLOSED",
          title: "Something broke",
          url: "https://github.com/jinjor/yuru/issues/71",
        },
        t1: pullRequestNode({ number: 72, url: "https://github.com/jinjor/yuru/pull/72" }),
      },
    },
  });
  const result = parseGitHubItemsResponse(raw, new Map([["jinjor/yuru", targets]]));
  assert.deepEqual(result.get(gitHubTargetKey(targets[0])), {
    status: {
      kind: "issue",
      number: 71,
      state: "closed",
      url: "https://github.com/jinjor/yuru/issues/71",
    },
    title: "Something broke",
    headRefOid: null,
  });
  assert.equal(result.get(gitHubTargetKey(targets[1])).status.kind, "pr");
});

test("parseGitHubItemsResponse は解決できなかった repository の分だけを結果から落とす", () => {
  const yuruTargets = [numberTarget(71)];
  const cliTarget = { kind: "number", repoSlug: "cli/cli", number: 900 };
  // gh は errors があると非ゼロで終わるが、解決できた repository の分は data に入っている。
  const raw = JSON.stringify({
    data: {
      r0: { t0: pullRequestNode({ number: 71 }) },
      r1: null,
    },
    errors: [{ type: "NOT_FOUND", path: ["r1"] }],
  });
  const result = parseGitHubItemsResponse(
    raw,
    new Map([
      ["jinjor/yuru", yuruTargets],
      ["cli/cli", [cliTarget]],
    ]),
  );
  assert.equal(result.get(gitHubTargetKey(yuruTargets[0])).status.number, 71);
  assert.equal(result.has(gitHubTargetKey(cliTarget)), false, "取れなかった分は前回値を使う");
});

test("parseGitHubItemsResponse は想定外の形なら null を返す", () => {
  const targetsByRepoSlug = new Map([["jinjor/yuru", [branchTarget("a")]]]);
  assert.equal(parseGitHubItemsResponse("not json", targetsByRepoSlug), null);
  assert.equal(parseGitHubItemsResponse(JSON.stringify({}), targetsByRepoSlug), null);
  assert.equal(parseGitHubItemsResponse(JSON.stringify({ data: null }), targetsByRepoSlug), null);
});

test("parseGitHubItemsResponse は必須フィールドが欠けた node を対象なし扱いにする", () => {
  const targets = [branchTarget("a"), numberTarget(71)];
  const raw = JSON.stringify({
    data: {
      r0: {
        t0: { nodes: [{ __typename: "PullRequest", number: 1, state: "OPEN", title: "x" }] },
        t1: { __typename: "Issue", number: 71, state: "PLANNED", title: "x", url: "u" },
      },
    },
  });
  const result = parseGitHubItemsResponse(raw, new Map([["jinjor/yuru", targets]]));
  assert.equal(result.get(gitHubTargetKey(targets[0])), null);
  assert.equal(result.get(gitHubTargetKey(targets[1])), null);
});

function fetchedPullRequest(state, headRefOid) {
  return {
    status: { kind: "pr", number: 1, state, isApproved: false, url: "https://example.com/1" },
    title: "Add a thing",
    headRefOid,
  };
}

test("toVisiblePullRequest は open/draft を head の一致に関わらず表示する", () => {
  const fetched = fetchedPullRequest("open", "sha-x");
  assert.deepEqual(toVisiblePullRequest(fetched, "sha-y"), fetched.status);
});

test("toVisiblePullRequest は merged/closed を head が一致するときだけ表示する", () => {
  const merged = fetchedPullRequest("merged", "sha-a");
  assert.deepEqual(toVisiblePullRequest(merged, "sha-a"), merged.status);
  assert.equal(toVisiblePullRequest(merged, "sha-b"), null);
  assert.equal(toVisiblePullRequest(fetchedPullRequest("closed", "sha-a"), "sha-b"), null);
});

test("toVisiblePullRequest は PR なしと issue を null にする", () => {
  assert.equal(toVisiblePullRequest(null, "sha-a"), null);
  assert.equal(
    toVisiblePullRequest(
      {
        status: { kind: "issue", number: 71, state: "open", url: "https://example.com/71" },
        title: "Something broke",
        headRefOid: null,
      },
      "sha-a",
    ),
    null,
  );
});
