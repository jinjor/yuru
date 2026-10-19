import fs from "fs";
import path from "path";
import type { GitBlame, GitBlameCommit, GitDiffScope } from "../../shared/ipc.js";
import { exec, isExitCode } from "../exec.js";
import { readDiffSource, resolveCurrentDiffSource } from "./diff.js";
import { getHeadSha } from "./repo.js";

const PORCELAIN_HEADER_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/;
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// 未コミットの行は、OID がすべて 0 の仮の commit に割り当てられる。
const UNCOMMITTED_OID_PATTERN = /^0+$/;

// porcelain に載っている分。履歴が切れているかは repository の状態で、出力からは分からない。
type PorcelainCommit = Omit<GitBlameCommit, "historyTruncated">;

// `git blame --porcelain` の出力を解釈する。形式は git-blame の "THE PORCELAIN FORMAT":
// 最終版の 1 行ごとに `<oid> <元の行番号> <最終の行番号> [<行数>]` の header が来て、
// その commit が初めて出たときだけ `<key> <value>` の情報行が続き、最後に TAB で始まる
// 行の中身が来る。header は最終版の行の順に来る。
export function parseBlamePorcelain(output: string): {
  lines: GitBlame["lines"];
  commits: PorcelainCommit[];
} {
  const rows = output.split("\n");
  const commits: PorcelainCommit[] = [];
  const commitIndexByOid = new Map<string, number>();
  const lines: (number | null)[] = [];

  let index = 0;
  // 出力は改行で終わるので、split の最後の要素は空になる。
  while (index < rows.length - 1) {
    const header = rows[index];
    const match = PORCELAIN_HEADER_PATTERN.exec(header);
    if (!match) {
      throw new Error(`Unexpected blame porcelain header: ${JSON.stringify(header)}`);
    }
    const [, oid, finalLine] = match;
    if (Number(finalLine) !== lines.length + 1) {
      throw new Error(
        `Unexpected blame porcelain output: expected line ${lines.length + 1}, got ${finalLine}`,
      );
    }
    index++;

    const fields = new Map<string, string>();
    while (index < rows.length && !rows[index].startsWith("\t")) {
      const row = rows[index];
      const space = row.indexOf(" ");
      // `boundary` のように値を持たない情報行もある。
      fields.set(space < 0 ? row : row.slice(0, space), space < 0 ? "" : row.slice(space + 1));
      index++;
    }
    if (index >= rows.length) {
      throw new Error("Unexpected blame porcelain record: missing line content");
    }
    // 行の中身は使わない。
    index++;

    if (UNCOMMITTED_OID_PATTERN.test(oid)) {
      lines.push(null);
      continue;
    }
    let commitIndex = commitIndexByOid.get(oid);
    if (commitIndex === undefined) {
      const authorTime = Number(fields.get("author-time"));
      if (!Number.isFinite(authorTime)) {
        throw new Error(`Unexpected blame porcelain record: missing author-time for ${oid}`);
      }
      commitIndex = commits.length;
      commits.push({
        oid,
        author: fields.get("author") ?? "",
        authorTime: authorTime * 1000,
        summary: fields.get("summary") ?? "",
      });
      commitIndexByOid.set(oid, commitIndex);
    }
    lines.push(commitIndex);
  }
  return { lines, commits };
}

// 差分の表示側 (右側) の内容に対する blame。表示側にファイルが無ければ null。
// 表示側の内容を標準入力から渡し、HEAD からの履歴で blame する。HEAD と違う行は
// git が未コミットとして扱う。
export async function getGitBlame(
  cwd: string,
  filePath: string,
  scope: GitDiffScope | undefined,
): Promise<GitBlame | null> {
  const content = await readDiffSource(cwd, resolveCurrentDiffSource(filePath, scope));
  if (content === null) {
    return null;
  }
  if (!(await isBlameTarget(cwd, filePath))) {
    return { lines: Array.from({ length: countLines(content) }, () => null), commits: [] };
  }

  const [output, shallowOids] = await Promise.all([
    exec("git", ["blame", "--porcelain", "--contents", "-", "--", filePath], cwd, content),
    readShallowOids(cwd),
  ]);
  const { lines, commits } = parseBlamePorcelain(output);
  return {
    lines,
    commits: commits.map((commit) => ({
      ...commit,
      historyTruncated: shallowOids.has(commit.oid),
    })),
  };
}

export async function getGitCommitMessage(cwd: string, oid: string): Promise<string> {
  // oid は renderer から来るので、git の option として解釈されないよう形式を確かめる。
  if (!OBJECT_ID_PATTERN.test(oid)) {
    throw new Error(`Invalid commit id: ${JSON.stringify(oid)}`);
  }
  return (await exec("git", ["show", "-s", "--format=%B", oid, "--"], cwd)).trimEnd();
}

// git blame が扱えるのは HEAD か index にある path だけで、それ以外は失敗する。
// untracked のファイルと、まだ commit が無い repo では全行が未コミットになる。
async function isBlameTarget(cwd: string, filePath: string): Promise<boolean> {
  if (!(await getHeadSha(cwd))) {
    return false;
  }
  try {
    await exec(
      "git",
      ["--literal-pathspecs", "ls-files", "--error-unmatch", "--with-tree=HEAD", "--", filePath],
      cwd,
    );
    return true;
  } catch (error) {
    // --error-unmatch は、index にも HEAD にも無い path があると 1 で終わる。
    if (isExitCode(error, 1)) {
      return false;
    }
    throw error;
  }
}

// shallow clone で履歴が切れている commit。$GIT_DIR/shallow に 1 行 1 OID で並ぶ
// (gitrepository-layout)。shallow でなければファイル自体が無い。
async function readShallowOids(cwd: string): Promise<Set<string>> {
  const gitPath = (await exec("git", ["rev-parse", "--git-path", "shallow"], cwd)).trim();
  let content: string;
  try {
    content = await fs.promises.readFile(path.resolve(cwd, gitPath), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
  return new Set(content.split("\n").filter((line) => line.length > 0));
}

// git と同じ数え方: 改行で終わる内容は、その後ろを行に数えない。
function countLines(content: Buffer): number {
  const lines = content.toString("utf-8").split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}
