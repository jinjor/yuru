import type { GitLineStat, GitPathState } from "../shared/ipc";

function normalizePorcelainStatus(status: string): string {
  return status === " " ? "" : status;
}

// git-status(1) の仕様で unmerged と定義されている XY の組み合わせ
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function parsePorcelainLine(line: string): GitPathState | null {
  if (!line) {
    return null;
  }

  const rawStatus = line.substring(0, 2);
  let filePath = line.substring(3).trim();

  if (!filePath) {
    return null;
  }

  if (filePath.includes(" -> ")) {
    const parts = filePath.split(" -> ");
    filePath = parts[parts.length - 1] ?? filePath;
  }

  filePath = filePath.replace(/\/$/, "");

  if (rawStatus === "!!") {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "",
      conflicted: false,
      ignored: true,
    };
  }

  if (rawStatus === "??") {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "??",
      conflicted: false,
      ignored: false,
    };
  }

  if (UNMERGED_STATUSES.has(rawStatus)) {
    return {
      path: filePath,
      indexStatus: "",
      worktreeStatus: "",
      conflicted: true,
      ignored: false,
    };
  }

  return {
    path: filePath,
    indexStatus: normalizePorcelainStatus(rawStatus[0] ?? ""),
    worktreeStatus: normalizePorcelainStatus(rawStatus[1] ?? ""),
    conflicted: false,
    ignored: false,
  };
}

export interface NameStatusEntry {
  status: string;
  path: string;
  srcPath?: string;
}

// `git diff --name-status -z` の出力を解釈する。
// 全 field が NUL 区切りで `<status>\0<path>\0` と並び、
// rename/copy では `<R|C><score>\0<src>\0<dst>\0` になる。
export function parseNameStatusZ(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  const tokens = output.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (status === "") {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const src = tokens[i + 1];
      const dst = tokens[i + 2];
      if (src === undefined || dst === undefined) {
        throw new Error("Unexpected name-status rename record: missing paths");
      }
      entries.push({ status, path: dst, srcPath: src });
      i += 2;
      continue;
    }

    const path = tokens[i + 1];
    if (path === undefined) {
      throw new Error(`Unexpected name-status record: ${JSON.stringify(status)}`);
    }
    entries.push({ status, path });
    i += 1;
  }

  return entries;
}

// `git diff --numstat -z` の出力を path -> 行数 の Map にする。
// レコードは `<added>\t<deleted>\t<path>\0`、rename/copy では path 部分が空になり
// 続けて `<src>\0<dst>\0` が並ぶ (git-diff の "Other diff formats" 参照)。
// binary file は added/deleted が `-` になるため、行数なしとして Map に含めない。
export function parseNumstatZ(output: string): Map<string, GitLineStat> {
  const stats = new Map<string, GitLineStat>();
  const tokens = output.split("\0");

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "") {
      continue;
    }

    const firstTab = token.indexOf("\t");
    const secondTab = token.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error(`Unexpected numstat record: ${JSON.stringify(token)}`);
    }

    const addedField = token.substring(0, firstTab);
    const deletedField = token.substring(firstTab + 1, secondTab);
    let path = token.substring(secondTab + 1);

    if (path === "") {
      // rename/copy: 続く 2 token が src と dst
      const dst = tokens[i + 2];
      if (dst === undefined) {
        throw new Error("Unexpected numstat rename record: missing paths");
      }
      path = dst;
      i += 2;
    }

    if (addedField === "-" || deletedField === "-") {
      continue;
    }

    stats.set(path, {
      added: Number.parseInt(addedField, 10),
      deleted: Number.parseInt(deletedField, 10),
    });
  }

  return stats;
}
