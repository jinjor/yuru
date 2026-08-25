import assert from "node:assert/strict";
import test from "node:test";

import { classifyClaudeTranscriptLine } from "../../../src/main/agents/claude/rate-limit-stop.ts";
import { classifyCodexRolloutLine } from "../../../src/main/agents/codex/rate-limit-stop.ts";
import { classifyKimiSessionLogLine } from "../../../src/main/agents/kimi/rate-limit-stop.ts";

// 実際の記録から写した形。付き合わせた元の記録は F58 の調査時のもの。
const claude = {
  refused: JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-15T16:54:17.969Z",
    error: "rate_limit",
    apiErrorStatus: 429,
    isApiErrorMessage: true,
    message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "You've hit your session limit · resets 5am (Asia/Tokyo)" }] },
  }),
  loggedOut: JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-26T01:41:05.763Z",
    error: "authentication_failed",
    isApiErrorMessage: true,
    message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "Login expired · Please run /login" }] },
  }),
  turnDuration: JSON.stringify({
    type: "system",
    subtype: "turn_duration",
    durationMs: 737598,
    timestamp: "2026-07-15T16:54:17.971Z",
    isMeta: false,
  }),
  lastPrompt: JSON.stringify({ type: "last-prompt", lastPrompt: "…", leafUuid: "eb85" }),
  fileHistory: JSON.stringify({ type: "file-history-snapshot" }),
  userMessage: JSON.stringify({
    type: "user",
    timestamp: "2026-07-15T18:33:45.708Z",
    message: { role: "user", content: [{ type: "text", text: "続けて" }] },
  }),
};

test("claude: an api error refused for rate limiting is a stop", () => {
  assert.equal(classifyClaudeTranscriptLine(claude.refused), "stopped");
});

test("claude: a login failure is not a rate limit stop", () => {
  assert.equal(classifyClaudeTranscriptLine(claude.loggedOut), "moved-on");
});

test("claude: bookkeeping entries written right after the refusal are ignored", () => {
  assert.equal(classifyClaudeTranscriptLine(claude.turnDuration), null);
  assert.equal(classifyClaudeTranscriptLine(claude.lastPrompt), null);
  assert.equal(classifyClaudeTranscriptLine(claude.fileHistory), null);
});

test("claude: a later conversation message means the session moved on", () => {
  assert.equal(classifyClaudeTranscriptLine(claude.userMessage), "moved-on");
});

test("claude: an unreadable line is ignored", () => {
  assert.equal(classifyClaudeTranscriptLine('{"type":"assis'), null);
});

const codex = {
  refused: JSON.stringify({
    timestamp: "2026-08-25T16:56:58.175Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "01a039da",
      last_agent_message: null,
      error: {
        message: "You've hit your usage limit. Upgrade to Pro ... try again at 5:12 AM.",
        codex_error_info: "usage_limit_exceeded",
      },
    },
  }),
  otherError: JSON.stringify({
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "01a039da",
      last_agent_message: null,
      error: { message: "stream disconnected", codex_error_info: "stream_error" },
    },
  }),
  taskComplete: JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "019dc7f1", last_agent_message: null },
  }),
  tokenCount: JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } }),
  taskStarted: JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started", turn_id: "019dc8d0" },
  }),
  responseItem: JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "続き" }] },
  }),
};

test("codex: a usage limit error is a stop", () => {
  assert.equal(classifyCodexRolloutLine(codex.refused), "stopped");
});

test("codex: a turn failed for another reason is not a stop", () => {
  assert.equal(classifyCodexRolloutLine(codex.otherError), null);
});

test("codex: a turn that ended without an error is not a stop", () => {
  assert.equal(classifyCodexRolloutLine(codex.taskComplete), null);
});

test("codex: bookkeeping entries written right after the refusal are ignored", () => {
  assert.equal(classifyCodexRolloutLine(codex.tokenCount), null);
});

test("codex: the next turn starting means the session moved on", () => {
  assert.equal(classifyCodexRolloutLine(codex.taskStarted), "moved-on");
});

test("codex: conversation items alone do not decide", () => {
  assert.equal(classifyCodexRolloutLine(codex.responseItem), null);
});

const kimi = {
  refused:
    '2026-08-15T15:15:49.889Z WARN  llm request failed  turnStep=0.4 attempt=1/10 model=k3 ' +
    'errorName=APIStatusError errorMessage="403 You\'ve reached your usage limit for this billing cycle." statusCode=403',
  refusedInSubagent:
    '2026-08-15T15:15:49.149Z WARN  llm request failed  turnStep=0.1 attempt=1/10 model=k3 ' +
    'errorName=APIStatusError errorMessage="403 ..." statusCode=403 agentId=agent-0',
  turnFailed: "2026-08-15T15:15:49.892Z ERROR turn failed  turnId=0",
  resume: "2026-08-15T15:24:59.987Z INFO  session resume  app_version=0.29.2",
  request: "2026-08-15T15:38:54.880Z INFO  llm request  turnStep=1.1",
  response: "2026-08-15T15:39:01.791Z INFO  llm response  turnStep=1/1 ttftMs=3945",
};

test("kimi: a refused request is a stop", () => {
  assert.equal(classifyKimiSessionLogLine(kimi.refused), "stopped");
});

test("kimi: a subagent's refusal is not the main agent stopping", () => {
  assert.equal(classifyKimiSessionLogLine(kimi.refusedInSubagent), null);
});

test("kimi: the lines written around the refusal are ignored", () => {
  assert.equal(classifyKimiSessionLogLine(kimi.turnFailed), null);
  assert.equal(classifyKimiSessionLogLine(kimi.resume), null);
  assert.equal(classifyKimiSessionLogLine(kimi.response), null);
});

test("kimi: a new request means the session moved on", () => {
  assert.equal(classifyKimiSessionLogLine(kimi.request), "moved-on");
});
