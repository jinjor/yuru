import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { streamRipgrepLineMatches } from "../../src/main/ripgrep.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-ripgrep-test-"));

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function collectFileMatches(args, cwd) {
  const results = [];
  await streamRipgrepLineMatches(args, cwd, (filePath, lines) => {
    results.push([filePath, lines]);
  });
  return results;
}

test("streamRipgrepLineMatches はマッチ行をファイルごとにまとめて返す", async () => {
  const dir = path.join(tempDir, "basic");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), ["alpha one", "beta", "alpha two", ""].join("\n"));
  fs.writeFileSync(path.join(dir, "b.txt"), ["beta", "alpha three", ""].join("\n"));

  const results = await collectFileMatches(["--regexp", "alpha", "--", dir], dir);
  results.sort((a, b) => a[0].localeCompare(b[0]));

  assert.deepEqual(results, [
    [
      path.join(dir, "a.txt"),
      [
        { text: "alpha one", lineIndex: 0 },
        { text: "alpha two", lineIndex: 2 },
      ],
    ],
    [path.join(dir, "b.txt"), [{ text: "alpha three", lineIndex: 1 }]],
  ]);
});

test("streamRipgrepLineMatches はマッチなし (exit code 1) を空結果として扱う", async () => {
  const dir = path.join(tempDir, "no-match");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "beta\n");

  const results = await collectFileMatches(["--regexp", "alpha", "--", dir], dir);

  assert.deepEqual(results, []);
});

test("streamRipgrepLineMatches は rg の実行エラーを投げる", async () => {
  const missingDir = path.join(tempDir, "does-not-exist");

  await assert.rejects(
    collectFileMatches(["--regexp", "alpha", "--", missingDir], tempDir),
    (error) => error instanceof Error && error.message.length > 0,
  );
});

test("streamRipgrepLineMatches はコールバックのエラーを投げ直す", async () => {
  const dir = path.join(tempDir, "callback-error");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");

  await assert.rejects(
    streamRipgrepLineMatches(["--regexp", "alpha", "--", dir], dir, () => {
      throw new Error("callback failed");
    }),
    /callback failed/,
  );
});

test("streamRipgrepLineMatches はマッチ総量が 10MB を超えても読み切れる", async () => {
  const dir = path.join(tempDir, "large");
  fs.mkdirSync(dir, { recursive: true });
  const lineCount = 30000;
  const line = `alpha ${"x".repeat(400)}`;
  fs.writeFileSync(path.join(dir, "large.txt"), `${line}\n`.repeat(lineCount));

  let matchedLineCount = 0;
  await streamRipgrepLineMatches(["--regexp", "alpha", "--", dir], dir, (_filePath, lines) => {
    matchedLineCount += lines.length;
  });

  assert.equal(matchedLineCount, lineCount);
});
