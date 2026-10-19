import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getGitBlame,
  getGitCommitMessage,
  parseBlamePorcelain,
} from "../../../src/main/git/blame.ts";

function cleanGitEnv(env) {
  const next = { ...env };
  delete next.GIT_DIR;
  delete next.GIT_WORK_TREE;
  return next;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, env: cleanGitEnv(process.env), encoding: "utf8" }).trim();
}

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuru-blame-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeRepo(t) {
  const dir = makeTempDir(t);
  git(["init"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  return dir;
}

function commitAll(dir, message) {
  git(["add", "."], dir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], dir);
  return git(["rev-parse", "HEAD"], dir);
}

// 行ごとの commit の summary。未コミットは null。
function summaries(blame) {
  return blame.lines.map((index) => (index === null ? null : blame.commits[index].summary));
}

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const OID_ZERO = "0".repeat(40);

function porcelainCommit(oid, summary) {
  return [
    "author Alice",
    "author-mail <alice@example.com>",
    "author-time 1700000000",
    "author-tz +0900",
    "committer Alice",
    "committer-mail <alice@example.com>",
    "committer-time 1700000000",
    "committer-tz +0900",
    `summary ${summary}`,
    "boundary",
    "filename a.txt",
  ];
}

test("parseBlamePorcelain は行ごとに commit を割り当て、2 回目以降の commit は情報行なしでも引ける", () => {
  const output = [
    `${OID_A} 1 1 2`,
    ...porcelainCommit(OID_A, "first"),
    "\tline 1",
    `${OID_A} 2 2`,
    "filename a.txt",
    "\tline 2",
    `${OID_ZERO} 3 3 1`,
    ...porcelainCommit(OID_ZERO, "Version of a.txt from standard input"),
    "\t",
    `${OID_B} 3 4 1`,
    ...porcelainCommit(OID_B, "second"),
    "\tline 4",
    "",
  ].join("\n");

  const blame = parseBlamePorcelain(output);

  assert.deepEqual(blame.lines, [0, 0, null, 1]);
  assert.deepEqual(blame.commits, [
    {
      oid: OID_A,
      author: "Alice",
      authorTime: 1700000000 * 1000,
      summary: "first",
    },
    {
      oid: OID_B,
      author: "Alice",
      authorTime: 1700000000 * 1000,
      summary: "second",
    },
  ]);
});

test("parseBlamePorcelain は想定外の header と、行の順に来ない出力を拒否する", () => {
  assert.throws(() => parseBlamePorcelain("not a header\n"), /Unexpected blame/);
  const skipped = [`${OID_A} 2 2 1`, ...porcelainCommit(OID_A, "first"), "\tline 2", ""].join(
    "\n",
  );
  assert.throws(() => parseBlamePorcelain(skipped), /expected line 1, got 2/);
});

test("getGitBlame は作業ツリーの未コミットの行を null にする", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  commitAll(dir, "first");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
  commitAll(dir, "second");
  fs.writeFileSync(path.join(dir, "a.txt"), "zero\none\ntwo\nthree\n");

  const blame = await getGitBlame(dir, "a.txt", undefined);

  assert.deepEqual(summaries(blame), [null, "first", "first", "second"]);
  assert.equal(blame.commits[0].author, "Test");
});

test("getGitBlame は staged では stage 済みの内容を blame し、unstaged の行を含めない", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  commitAll(dir, "first");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\nstaged\n");
  git(["add", "a.txt"], dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\nstaged\nunstaged\n");

  assert.deepEqual(summaries(await getGitBlame(dir, "a.txt", "staged")), ["first", null]);
  assert.deepEqual(summaries(await getGitBlame(dir, "a.txt", "unstaged")), ["first", null, null]);
});

test("getGitBlame は committed では HEAD の内容を blame する", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  commitAll(dir, "first");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  commitAll(dir, "second");
  fs.writeFileSync(path.join(dir, "a.txt"), "uncommitted\n");

  assert.deepEqual(summaries(await getGitBlame(dir, "a.txt", "base")), ["first", "second"]);
});

test("getGitBlame は stage 済みの rename を元の path の履歴まで遡る", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "old.txt"), "1\n2\n3\n4\n5\n");
  commitAll(dir, "first");
  git(["mv", "old.txt", "new.txt"], dir);

  assert.deepEqual(summaries(await getGitBlame(dir, "new.txt", undefined)), [
    "first",
    "first",
    "first",
    "first",
    "first",
  ]);
});

test("getGitBlame は untracked のファイルとコミットの無い repo で全行を未コミットにする", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo");

  assert.deepEqual(await getGitBlame(dir, "a.txt", undefined), {
    lines: [null, null],
    commits: [],
  });

  fs.writeFileSync(path.join(dir, "tracked.txt"), "tracked\n");
  commitAll(dir, "first");
  fs.writeFileSync(path.join(dir, "untracked.txt"), "one\n");
  assert.deepEqual(await getGitBlame(dir, "untracked.txt", undefined), {
    lines: [null],
    commits: [],
  });
});

test("getGitBlame は表示側にファイルが無ければ null を返す", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  commitAll(dir, "first");
  fs.rmSync(path.join(dir, "a.txt"));

  assert.equal(await getGitBlame(dir, "a.txt", undefined), null);
});

test("getGitBlame は shallow clone の境界 commit を履歴切れとして印を付ける", async (t) => {
  const origin = makeRepo(t);
  fs.writeFileSync(path.join(origin, "a.txt"), "one\n");
  commitAll(origin, "first");
  fs.writeFileSync(path.join(origin, "a.txt"), "one\ntwo\n");
  commitAll(origin, "second");
  fs.writeFileSync(path.join(origin, "a.txt"), "one\ntwo\nthree\n");
  commitAll(origin, "third");

  const clone = path.join(makeTempDir(t), "clone");
  git(["clone", "--depth", "2", `file://${origin}`, clone], origin);

  const blame = await getGitBlame(clone, "a.txt", undefined);

  // 境界の second より古い one も second のものとして出るが、履歴切れの印で見分けられる。
  assert.deepEqual(summaries(blame), ["second", "second", "third"]);
  assert.deepEqual(
    blame.commits.map((commit) => [commit.summary, commit.historyTruncated]),
    [
      ["second", true],
      ["third", false],
    ],
  );
});

test("getGitCommitMessage はメッセージ全文を返し、OID でない値は git に渡さない", async (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  const oid = commitAll(dir, "Summary line\n\nBody line");

  assert.equal(await getGitCommitMessage(dir, oid), "Summary line\n\nBody line");
  await assert.rejects(() => getGitCommitMessage(dir, "--output=/tmp/x"), /Invalid commit id/);
});
