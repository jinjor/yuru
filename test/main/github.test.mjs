import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGitHubPullRequestQuery,
  parseGitHubPullRequestsResponse,
  toVisiblePullRequest,
} from "../../src/main/github.ts";

test("buildGitHubPullRequestQuery は branch ごとのエイリアスを 1 クエリに束ねる", () => {
  const query = buildGitHubPullRequestQuery("jinjor/yuru", ["feature-a", "feature-b"]);
  assert.match(query, /repository\(owner: "jinjor", name: "yuru"\)/);
  assert.match(query, /b0: pullRequests\(headRefName: "feature-a", first: 1/);
  assert.match(query, /b1: pullRequests\(headRefName: "feature-b", first: 1/);
  assert.match(query, /orderBy: \{field: CREATED_AT, direction: DESC\}/);
  assert.match(query, /nodes \{ number state isDraft reviewDecision headRefOid url \}/);
});

test("buildGitHubPullRequestQuery は branch 名の引用符をエスケープする", () => {
  const query = buildGitHubPullRequestQuery("jinjor/yuru", ['a"b']);
  assert.match(query, /headRefName: "a\\"b"/);
});

test("parseGitHubPullRequestsResponse は state と isDraft を PR の状態へ写す", () => {
  const raw = JSON.stringify({
    data: {
      repository: {
        b0: {
          nodes: [
            {
              number: 1,
              state: "OPEN",
              isDraft: false,
              reviewDecision: "APPROVED",
              headRefOid: "sha-1",
              url: "https://example.com/1",
            },
          ],
        },
        b1: {
          nodes: [
            {
              number: 2,
              state: "OPEN",
              isDraft: true,
              reviewDecision: null,
              headRefOid: "sha-2",
              url: "https://example.com/2",
            },
          ],
        },
        b2: {
          nodes: [
            {
              number: 3,
              state: "MERGED",
              isDraft: false,
              reviewDecision: "APPROVED",
              headRefOid: "sha-3",
              url: "https://example.com/3",
            },
          ],
        },
        b3: {
          nodes: [
            {
              number: 4,
              state: "CLOSED",
              isDraft: false,
              reviewDecision: "CHANGES_REQUESTED",
              headRefOid: "sha-4",
              url: "https://example.com/4",
            },
          ],
        },
        b4: { nodes: [] },
      },
    },
  });
  const result = parseGitHubPullRequestsResponse(raw, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(result.get("a"), {
    pullRequest: {
      prNumber: 1,
      state: "open",
      isApproved: true,
      url: "https://example.com/1",
    },
    headRefOid: "sha-1",
  });
  assert.deepEqual(result.get("b"), {
    pullRequest: {
      prNumber: 2,
      state: "draft",
      isApproved: false,
      url: "https://example.com/2",
    },
    headRefOid: "sha-2",
  });
  assert.deepEqual(result.get("c"), {
    pullRequest: {
      prNumber: 3,
      state: "merged",
      isApproved: true,
      url: "https://example.com/3",
    },
    headRefOid: "sha-3",
  });
  assert.deepEqual(result.get("d"), {
    pullRequest: {
      prNumber: 4,
      state: "closed",
      isApproved: false,
      url: "https://example.com/4",
    },
    headRefOid: "sha-4",
  });
  assert.equal(result.get("e"), null);
});

test("parseGitHubPullRequestsResponse は想定外の形なら null を返す", () => {
  assert.equal(parseGitHubPullRequestsResponse("not json", ["a"]), null);
  assert.equal(parseGitHubPullRequestsResponse(JSON.stringify({ data: {} }), ["a"]), null);
  assert.equal(
    parseGitHubPullRequestsResponse(JSON.stringify({ data: { repository: null } }), ["a"]),
    null,
  );
});

test("parseGitHubPullRequestsResponse は必須フィールドが欠けた node を PR なし扱いにする", () => {
  const raw = JSON.stringify({
    data: {
      repository: {
        b0: { nodes: [{ number: 1, state: "OPEN", isDraft: false, url: "https://example.com/1" }] },
      },
    },
  });
  const result = parseGitHubPullRequestsResponse(raw, ["a"]);
  assert.equal(result.get("a"), null);
});

test("toVisiblePullRequest は open/draft を head の一致に関わらず表示する", () => {
  const openPullRequest = {
    prNumber: 1,
    state: "open",
    isApproved: true,
    url: "https://example.com/1",
  };
  assert.deepEqual(
    toVisiblePullRequest({ pullRequest: openPullRequest, headRefOid: "sha-x" }, "sha-y"),
    openPullRequest,
  );
});

test("toVisiblePullRequest は merged/closed を head が一致するときだけ表示する", () => {
  const mergedPullRequest = {
    prNumber: 2,
    state: "merged",
    isApproved: true,
    url: "https://example.com/2",
  };
  assert.deepEqual(
    toVisiblePullRequest({ pullRequest: mergedPullRequest, headRefOid: "sha-a" }, "sha-a"),
    mergedPullRequest,
  );
  assert.equal(
    toVisiblePullRequest({ pullRequest: mergedPullRequest, headRefOid: "sha-a" }, "sha-b"),
    null,
  );

  const closedPullRequest = {
    prNumber: 3,
    state: "closed",
    isApproved: false,
    url: "https://example.com/3",
  };
  assert.equal(
    toVisiblePullRequest({ pullRequest: closedPullRequest, headRefOid: "sha-a" }, "sha-b"),
    null,
  );
});

test("toVisiblePullRequest は PR なしを null のまま返す", () => {
  assert.equal(toVisiblePullRequest(null, "sha-a"), null);
});
