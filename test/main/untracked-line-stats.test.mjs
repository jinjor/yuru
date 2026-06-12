import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getUntrackedLineStats } from "../../src/main/untracked-line-stats.ts";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "yuru-untracked-"));
}

test("getUntrackedLineStats は改行数を追加行数として数える", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");

  const stats = await getUntrackedLineStats(dir, ["a.txt"]);

  assert.deepEqual(stats.get("a.txt"), { added: 3, deleted: 0 });
});

test("getUntrackedLineStats は改行で終わらない最後の行も数える", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo");

  const stats = await getUntrackedLineStats(dir, ["a.txt"]);

  assert.deepEqual(stats.get("a.txt"), { added: 2, deleted: 0 });
});

test("getUntrackedLineStats は空 file を 0 行として数える", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "empty.txt"), "");

  const stats = await getUntrackedLineStats(dir, ["empty.txt"]);

  assert.deepEqual(stats.get("empty.txt"), { added: 0, deleted: 0 });
});

test("getUntrackedLineStats は binary file と存在しない file を除く", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));

  const stats = await getUntrackedLineStats(dir, ["binary.bin", "missing.txt"]);

  assert.equal(stats.has("binary.bin"), false);
  assert.equal(stats.has("missing.txt"), false);
});

test("getUntrackedLineStats は file の変更を 2 回目以降の呼び出しにも反映する", async () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "a.txt");
  fs.writeFileSync(filePath, "one\n");

  const first = await getUntrackedLineStats(dir, ["a.txt"]);
  assert.deepEqual(first.get("a.txt"), { added: 1, deleted: 0 });

  fs.writeFileSync(filePath, "one\ntwo\nthree\n");
  const second = await getUntrackedLineStats(dir, ["a.txt"]);
  assert.deepEqual(second.get("a.txt"), { added: 3, deleted: 0 });
});
