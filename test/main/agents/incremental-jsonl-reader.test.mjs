import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IncrementalJsonlReader } from "../../../src/main/agents/incremental-jsonl-reader.ts";

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

test("追記されたJSONだけを返す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, jsonl({ value: 1 }));

  const reader = new IncrementalJsonlReader(filePath);
  assert.deepEqual(await reader.read(), { entries: [{ value: 1 }], reset: false });
  assert.deepEqual(await reader.read(), { entries: [], reset: false });

  fs.appendFileSync(filePath, jsonl({ value: 2 }));
  assert.deepEqual(await reader.read(), { entries: [{ value: 2 }], reset: false });
});

test("途中までの末尾recordは完成後に一度だけ返す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  const line = JSON.stringify({ value: "complete" });
  const splitAt = Math.floor(line.length / 2);
  fs.writeFileSync(filePath, line.slice(0, splitAt));

  const reader = new IncrementalJsonlReader(filePath);
  assert.deepEqual(await reader.read(), { entries: [], reset: false });
  fs.appendFileSync(filePath, line.slice(splitAt));
  assert.deepEqual(await reader.read(), { entries: [{ value: "complete" }], reset: false });
  assert.deepEqual(await reader.read(), { entries: [], reset: false });
});

test("reset後は先頭から読み直す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, jsonl({ value: 1 }));

  const reader = new IncrementalJsonlReader(filePath);
  await reader.read();
  await reader.reset();
  assert.deepEqual(await reader.read(), { entries: [{ value: 1 }], reset: false });
});

test("file差し替え時は先頭から読み直してresetを返す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  const replacementPath = path.join(dir, "replacement.jsonl");
  fs.writeFileSync(filePath, jsonl({ value: "old" }));

  const reader = new IncrementalJsonlReader(filePath);
  await reader.read();
  fs.writeFileSync(replacementPath, jsonl({ value: "replacement" }));
  fs.renameSync(replacementPath, filePath);

  assert.deepEqual(await reader.read(), {
    entries: [{ value: "replacement" }],
    reset: true,
  });
});

test("存在しないfileはnullを返す", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const reader = new IncrementalJsonlReader(path.join(dir, "missing.jsonl"));
  assert.equal(await reader.read(), null);
});
