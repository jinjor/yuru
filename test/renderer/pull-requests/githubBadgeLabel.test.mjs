import assert from "node:assert/strict";
import test from "node:test";

import { gitHubBadgeLabel } from "../../../src/renderer/pull-requests/githubBadgeLabel.ts";

function pullRequest(state, isApproved) {
  return {
    kind: "pr",
    number: 42,
    state,
    isApproved,
    url: "https://example.com/42",
  };
}

function issue(state) {
  return {
    kind: "issue",
    number: 7,
    state,
    url: "https://example.com/7",
  };
}

test("open PR は approval に応じて Approved または Open と表示する", () => {
  assert.equal(gitHubBadgeLabel(pullRequest("open", true)), "Approved #42");
  assert.equal(gitHubBadgeLabel(pullRequest("open", false)), "Open #42");
});

test("draft/merged/closed は approval より PR state の表示を優先する", () => {
  assert.equal(gitHubBadgeLabel(pullRequest("draft", true)), "Draft #42");
  assert.equal(gitHubBadgeLabel(pullRequest("merged", true)), "Merged #42");
  assert.equal(gitHubBadgeLabel(pullRequest("closed", true)), "Closed #42");
});

test("issue は open / closed をそのまま表示する", () => {
  assert.equal(gitHubBadgeLabel(issue("open")), "Open #7");
  assert.equal(gitHubBadgeLabel(issue("closed")), "Closed #7");
});
