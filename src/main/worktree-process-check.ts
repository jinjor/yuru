import { exec } from "./exec.js";
import { isPathWithin } from "./worktree-identity.js";

// その worktree を作業場所 (cwd) にしている生きたプロセスがあるかを OS に問い合わせる。
// 削除でディレクトリと git の管理情報が消えても、cwd を失ったプロセスは死なずに残り、
// 以降の操作が全部失敗して気づきにくい。git は守ってくれないので Yuru 側で先回りして防ぐ.
//
// 開いているファイルハンドルは消しても閉じるまで生きるので幽霊化しない。cwd だけ見れば十分。
// `lsof -d cwd` で全プロセスの cwd 一覧を取り、worktree のパスで絞るだけ (再帰スキャンはしない)。
//
// lsof は自分自身も列挙するため、対象 worktree の外 (repo root) で起動する。worktree を作業場所に
// すると lsof 自身の cwd が引っかかって常に true になってしまう。
export async function hasLiveProcessInWorktree(
  worktreePath: string,
  repoPath: string,
): Promise<boolean> {
  const output = await exec("lsof", ["-w", "-d", "cwd", "-F", "pn"], repoPath);
  return parseLsofCwdPaths(output).some((cwd) => isPathWithin(worktreePath, cwd));
}

// `lsof -F pn` は 1 行 1 フィールドで、`n` 行が cwd のパス。それ以外のフィールド行は無視する。
export function parseLsofCwdPaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}
