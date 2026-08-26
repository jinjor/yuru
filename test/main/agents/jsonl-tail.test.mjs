import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readLatestJsonlEntry } from "../../../src/main/agents/jsonl-tail.ts";

function jsonl(...entries) {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function parsePreview(entry) {
  return typeof entry === "object" && entry !== null && entry.kind === "preview"
    ? entry.message
    : null;
}

test("末尾側のpreviewが見つかった時点で巨大な過去recordを読まない", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-tail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(
    filePath,
    jsonl(
      { kind: "other", content: "x".repeat(4 * 1024 * 1024) },
      { kind: "preview", message: "latest" },
      { kind: "other" },
    ),
  );

  const handle = await fs.promises.open(filePath, "r");
  t.after(() => handle.close());
  let totalBytesRead = 0;
  const countingHandle = {
    async read(...args) {
      const result = await handle.read(...args);
      totalBytesRead += result.bytesRead;
      return result;
    },
  };

  const stat = await handle.stat();
  assert.deepEqual(await readLatestJsonlEntry(countingHandle, stat.size, parsePreview), {
    entry: "latest",
    completeByteOffset: stat.size,
  });
  assert.ok(totalBytesRead < 128 * 1024, `read ${totalBytesRead} bytes`);
});

test("改行のない末尾recordをoffsetに含めず、途中の不完全なJSONを読み飛ばす", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-jsonl-tail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "session.jsonl");
  const complete = jsonl({ kind: "preview", message: "complete" });
  fs.writeFileSync(filePath, `${complete}{"kind":"preview"`);

  const handle = await fs.promises.open(filePath, "r");
  t.after(() => handle.close());
  const stat = await handle.stat();

  assert.deepEqual(await readLatestJsonlEntry(handle, stat.size, parsePreview), {
    entry: "complete",
    completeByteOffset: Buffer.byteLength(complete),
  });
});
