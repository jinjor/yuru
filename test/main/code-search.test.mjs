import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { searchCode } from "../../src/main/code-search.ts";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-code-search-test-"));

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("searchCode は rg の JSON 結果をファイルごとにまとめる", async () => {
  fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, "src", "alpha.ts"),
    ["const alpha = 1;", "console.log(alpha);", ""].join("\n"),
  );
  fs.writeFileSync(path.join(tempDir, "README.md"), "alpha notes\n");

  const result = await searchCode(tempDir, "alpha", {
    signal: new AbortController().signal,
    limit: 10,
  });

  assert.equal(result.matchCount, 3);
  assert.equal(result.truncated, false);
  const files = result.files
    .map((file) => [file.path, file.matches.map((match) => match.lineNumber)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(
    files,
    [
      ["README.md", [1]],
      ["src/alpha.ts", [1, 2]],
    ],
  );
});

test("searchCode は Unicode 行でも highlight range を文字位置で返す", async () => {
  fs.writeFileSync(path.join(tempDir, "unicode.txt"), "日本語 alpha\n");

  const result = await searchCode(tempDir, "語", {
    signal: new AbortController().signal,
    limit: 10,
  });
  const match = result.files.find((file) => file.path === "unicode.txt")?.matches[0];

  assert.ok(match);
  assert.equal(match.line.slice(match.ranges[0].start, match.ranges[0].end), "語");
});

test("searchCode は絵文字の前後でも highlight range を文字位置で返す", async () => {
  fs.writeFileSync(path.join(tempDir, "emoji.txt"), "🙂alpha🙂\n");

  const result = await searchCode(tempDir, "alpha", {
    signal: new AbortController().signal,
    limit: 10,
  });
  const match = result.files.find((file) => file.path === "emoji.txt")?.matches[0];

  assert.ok(match);
  assert.equal(match.line.slice(match.ranges[0].start, match.ranges[0].end), "alpha");
});

test("searchCode は最初の match 周辺だけを preview として返す", async () => {
  const token = "__YURU_LONG_MATCH__";
  const line = `${"prefix ".repeat(100)}${token} suffix\n`;
  fs.writeFileSync(path.join(tempDir, "long-preview.txt"), line);

  const result = await searchCode(tempDir, token, {
    signal: new AbortController().signal,
    limit: 10,
  });
  const match = result.files.find((file) => file.path === "long-preview.txt")?.matches[0];

  assert.ok(match);
  assert.ok(match.line.length < line.length);
  assert.equal(match.line.slice(match.ranges[0].start, match.ranges[0].end), token);
});

test("searchCode は no match を空結果として返す", async () => {
  const result = await searchCode(tempDir, "__definitely_no_such_yuru_token__", {
    signal: new AbortController().signal,
    limit: 10,
  });

  assert.deepEqual(result.files, []);
  assert.equal(result.matchCount, 0);
});

test("searchCode は PATH に rg が無くても同梱バイナリで検索する", async () => {
  const previousPath = process.env.PATH;
  const emptyBinDir = path.join(tempDir, "empty-bin");
  fs.mkdirSync(emptyBinDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, "bundled-rg.txt"), "bundled-rg-token\n");

  process.env.PATH = emptyBinDir;
  try {
    const result = await searchCode(tempDir, "bundled-rg-token", {
      signal: new AbortController().signal,
      limit: 10,
    });

    assert.equal(result.matchCount, 1);
    assert.equal(result.files[0]?.path, "bundled-rg.txt");
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test("searchCode は ripgrep config によらず case-sensitive で検索する", async () => {
  const previousConfigPath = process.env.RIPGREP_CONFIG_PATH;
  const configPath = path.join(tempDir, "ripgrep-config");
  fs.writeFileSync(configPath, "--ignore-case\n");
  fs.writeFileSync(path.join(tempDir, "case-sensitive.txt"), "caseonlytoken\n");

  process.env.RIPGREP_CONFIG_PATH = configPath;
  try {
    const result = await searchCode(tempDir, "CaseOnlyToken", {
      signal: new AbortController().signal,
      limit: 10,
    });

    assert.deepEqual(result.files, []);
    assert.equal(result.matchCount, 0);
  } finally {
    if (previousConfigPath === undefined) {
      delete process.env.RIPGREP_CONFIG_PATH;
    } else {
      process.env.RIPGREP_CONFIG_PATH = previousConfigPath;
    }
  }
});

test("searchCode は非 UTF-8 の検索結果を明示エラーにする", async () => {
  fs.writeFileSync(
    path.join(tempDir, "non-utf8.txt"),
    Buffer.concat([Buffer.from([0xff]), Buffer.from("nonUtfNeedle\n")]),
  );

  await assert.rejects(
    () =>
      searchCode(tempDir, "nonUtfNeedle", {
        signal: new AbortController().signal,
        limit: 10,
      }),
    /non-UTF-8/,
  );
});

test("searchCode は query の前後の空白を検索文字として扱う", async () => {
  fs.writeFileSync(path.join(tempDir, "spaces.txt"), "alpha\nalpha \n");

  const result = await searchCode(tempDir, "alpha ", {
    signal: new AbortController().signal,
    limit: 10,
  });

  assert.equal(result.files.find((file) => file.path === "spaces.txt")?.matches.length, 1);
});

test("searchCode は結果数の上限で打ち切る", async () => {
  fs.writeFileSync(path.join(tempDir, "many.txt"), "needle\nneedle\nneedle\n");

  const result = await searchCode(tempDir, "needle", {
    signal: new AbortController().signal,
    limit: 2,
  });

  assert.equal(result.matchCount, 2);
  assert.equal(result.truncated, true);
});

// rg の出力が複数の chunk に分かれると、打ち切って kill したあとにも chunk が届く。
// そこで match を積み足すと、上限ちょうどのはずの結果が 1 件ずつ増えてしまう。
test("searchCode は多数のファイルにまたがる結果でも上限ちょうどで打ち切る", async () => {
  const manyFilesDir = path.join(tempDir, "many-files");
  fs.mkdirSync(manyFilesDir, { recursive: true });
  for (let index = 0; index < 500; index++) {
    fs.writeFileSync(path.join(manyFilesDir, `file-${index}.txt`), "spread\n");
  }

  for (const limit of [1, 10, 100]) {
    const result = await searchCode(manyFilesDir, "spread", {
      signal: new AbortController().signal,
      limit,
    });
    const rows = result.files.reduce((count, file) => count + file.matches.length, 0);

    assert.equal(result.matchCount, limit);
    assert.equal(rows, limit);
    assert.equal(result.truncated, true);
  }
});

test("searchCode は打ち切り時に未完の JSON 末尾を parse しない", async () => {
  const longLine = `${"worktree ".repeat(2000)}\n`;
  fs.writeFileSync(path.join(tempDir, "large.txt"), longLine.repeat(200));

  const result = await searchCode(tempDir, "worktree", {
    signal: new AbortController().signal,
    limit: 1,
  });

  assert.equal(result.matchCount, 1);
  assert.equal(result.truncated, true);
});
