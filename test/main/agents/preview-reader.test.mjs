import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { IncrementalSessionPreviewReader } from "../../../src/main/agents/preview-reader.ts";

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function previewEntry(message, timestamp) {
  return { kind: "preview", message, timestamp };
}

function createReader(onParse = () => {}) {
  return new IncrementalSessionPreviewReader((entry) => {
    onParse();
    if (
      typeof entry !== "object" ||
      entry === null ||
      entry.kind !== "preview" ||
      typeof entry.message !== "string" ||
      typeof entry.timestamp !== "number"
    ) {
      return null;
    }
    return { lastMessage: entry.message, timestamp: entry.timestamp };
  });
}

test("初回は全JSONLから最新previewを選び、以降は追記されたrecordだけをparseする", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-preview-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, jsonl(previewEntry("old", 1), { kind: "other" }));

  let parseCount = 0;
  const reader = createReader(() => parseCount++);
  assert.deepEqual(await reader.read(filePath), { lastMessage: "old", timestamp: 1 });
  assert.equal(parseCount, 2);

  assert.deepEqual(await reader.read(filePath), { lastMessage: "old", timestamp: 1 });
  assert.equal(parseCount, 2);

  fs.appendFileSync(filePath, jsonl(previewEntry("new", 2)));
  assert.deepEqual(await reader.read(filePath), { lastMessage: "new", timestamp: 2 });
  assert.equal(parseCount, 3);
});

test("途中まで追記された末尾recordは完成後にpreviewへ反映する", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-preview-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  const nextLine = JSON.stringify(previewEntry("new", 2));
  const splitAt = Math.floor(nextLine.length / 2);
  fs.writeFileSync(filePath, `${jsonl(previewEntry("old", 1))}${nextLine.slice(0, splitAt)}`);

  const reader = createReader();
  assert.deepEqual(await reader.read(filePath), { lastMessage: "old", timestamp: 1 });

  fs.appendFileSync(filePath, `${nextLine.slice(splitAt)}\n`);
  assert.deepEqual(await reader.read(filePath), { lastMessage: "new", timestamp: 2 });
});

test("改行なしの完全な最終recordと存在しないfileを扱う", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-preview-reader-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  const reader = createReader();

  assert.equal(await reader.read(filePath), null);
  fs.writeFileSync(filePath, JSON.stringify(previewEntry("complete", 1)));
  assert.deepEqual(await reader.read(filePath), { lastMessage: "complete", timestamp: 1 });
});
