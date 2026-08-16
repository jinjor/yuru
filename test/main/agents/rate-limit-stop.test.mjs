import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isStoppedAtRateLimit } from "../../../src/main/agents/rate-limit-stop.ts";

function writeTemp(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-rate-limit-stop-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// "stopped" と "moved-on" 以外は読み飛ばす、という最小の分類。
function classify(line) {
  if (line.includes("STOP")) {
    return "stopped";
  }
  if (line.includes("GO")) {
    return "moved-on";
  }
  return null;
}

test("reports stopped when the refusal is the last mark", async () => {
  const filePath = writeTemp("log", ["GO", "STOP", "noise", "noise", ""].join("\n"));
  assert.equal(await isStoppedAtRateLimit(filePath, classify), true);
});

test("reports not stopped when the conversation moved on afterwards", async () => {
  const filePath = writeTemp("log", ["STOP", "noise", "GO", "noise", ""].join("\n"));
  assert.equal(await isStoppedAtRateLimit(filePath, classify), false);
});

test("reports not stopped when there is no mark at all", async () => {
  const filePath = writeTemp("log", ["noise", "noise", ""].join("\n"));
  assert.equal(await isStoppedAtRateLimit(filePath, classify), false);
});

test("reports not stopped when the file does not exist", async () => {
  assert.equal(await isStoppedAtRateLimit("/nonexistent/session.jsonl", classify), false);
});

test("reads the end of a file too large to read whole", async () => {
  const padding = `${"x".repeat(1000)}\n`.repeat(400); // > 256KiB
  const filePath = writeTemp("log", `STOP\n${padding}GO\n`);
  assert.equal(await isStoppedAtRateLimit(filePath, classify), false);
});

test("drops the partial first line when reading only the end", async () => {
  const padding = `${"x".repeat(1000)}\n`.repeat(400);
  // 末尾だけを読むと先頭が行の途中から始まる。切れた行を分類に使うと
  // 実際には無い印を読み取ってしまう。
  const filePath = writeTemp("log", `${padding}STOP-but-cut-off`);
  const seen = [];
  await isStoppedAtRateLimit(filePath, (line) => {
    seen.push(line);
    return null;
  });
  assert.equal(
    seen.some((line) => line.startsWith("x") && !line.startsWith("x".repeat(1000))),
    false,
  );
});
