import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionLogWatcher } from "../../../src/main/agents/session-log-watcher.ts";

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function parseEntry(entry) {
  if (typeof entry !== "object" || entry === null || typeof entry.text !== "string") {
    return null;
  }
  return {
    role: entry.role === "assistant" ? "assistant" : "user",
    text: entry.text,
    timestamp: typeof entry.ts === "number" ? entry.ts : 0,
  };
}

function createFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-session-log-watcher-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "session.jsonl");
}

test("読み取ったbatchは登録中の全listenerに通知される", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(filePath, jsonl({ role: "user", text: "m1" }));
  const watcher = new SessionLogWatcher(parseEntry);

  const messagesA = [];
  const messagesB = [];
  await watcher.watch(filePath, false, (next) => messagesA.push(...next));
  await watcher.watch(filePath, false, (next) => messagesB.push(...next));

  fs.appendFileSync(filePath, jsonl({ role: "assistant", text: "m2" }));
  await watcher.read(filePath);

  assert.deepEqual(messagesA, ["m2"]);
  assert.deepEqual(messagesB, ["m2"]);
});

test("includeExistingMessages=true は登録したlistenerにだけ過去分を再生する", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(filePath, jsonl({ role: "user", text: "m1" }));
  const watcher = new SessionLogWatcher(parseEntry);

  const messagesA = [];
  await watcher.watch(filePath, false, (next) => messagesA.push(...next));

  const messagesB = [];
  await watcher.watch(filePath, true, (next) => messagesB.push(...next));

  assert.deepEqual(messagesA, []);
  assert.deepEqual(messagesB, ["m1"]);

  fs.appendFileSync(filePath, jsonl({ role: "assistant", text: "m2" }));
  await watcher.read(filePath);

  assert.deepEqual(messagesA, ["m2"]);
  assert.deepEqual(messagesB, ["m1", "m2"]);
});

test("includeExistingMessages=false は登録後の追記だけを通知する", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(filePath, jsonl({ role: "user", text: "m1" }));
  const watcher = new SessionLogWatcher(parseEntry);

  const messages = [];
  await watcher.watch(filePath, false, (next) => messages.push(...next));
  assert.deepEqual(messages, []);

  fs.appendFileSync(filePath, jsonl({ role: "assistant", text: "m2" }));
  await watcher.read(filePath);
  assert.deepEqual(messages, ["m2"]);
});

test("stopしたlistenerには通知されない", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(filePath, jsonl({ role: "user", text: "m1" }));
  const watcher = new SessionLogWatcher(parseEntry);

  const messagesA = [];
  const messagesB = [];
  const stopA = await watcher.watch(filePath, false, (next) => messagesA.push(...next));
  await watcher.watch(filePath, false, (next) => messagesB.push(...next));
  stopA();

  fs.appendFileSync(filePath, jsonl({ role: "assistant", text: "m2" }));
  await watcher.read(filePath);

  assert.deepEqual(messagesA, []);
  assert.deepEqual(messagesB, ["m2"]);
});

test("previewはassistantの最新本文を空白正規化して返す", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(
    filePath,
    jsonl(
      { role: "user", text: "user message", ts: 3 },
      { role: "assistant", text: "first\nanswer", ts: 1 },
      { role: "assistant", text: "latest  answer", ts: 2 },
    ),
  );
  const watcher = new SessionLogWatcher(parseEntry);

  assert.deepEqual(await watcher.read(filePath), {
    lastMessage: "latest answer",
    timestamp: 2,
  });
});

test("file差し替え時はbatchを通知せずpreviewを再構築する", async (t) => {
  const filePath = createFixture(t);
  const replacementPath = path.join(path.dirname(filePath), "replacement.jsonl");
  fs.writeFileSync(filePath, jsonl({ role: "assistant", text: "old", ts: 1 }));
  const watcher = new SessionLogWatcher(parseEntry);

  const messages = [];
  await watcher.watch(filePath, true, (next) => messages.push(...next));
  assert.deepEqual(messages, ["old"]);

  fs.writeFileSync(replacementPath, jsonl({ role: "assistant", text: "replaced", ts: 2 }));
  fs.renameSync(replacementPath, filePath);
  const preview = await watcher.read(filePath);

  assert.deepEqual(messages, ["old"]);
  assert.deepEqual(preview, { lastMessage: "replaced", timestamp: 2 });
});

test("hasListeners は listener の登録・解除を反映する", async (t) => {
  const filePath = createFixture(t);
  fs.writeFileSync(filePath, jsonl({ role: "user", text: "m1" }));
  const watcher = new SessionLogWatcher(parseEntry);

  assert.equal(watcher.hasListeners(filePath), false);

  const stop = await watcher.watch(filePath, false, () => {});
  assert.equal(watcher.hasListeners(filePath), true);

  stop();
  assert.equal(watcher.hasListeners(filePath), false);
});
