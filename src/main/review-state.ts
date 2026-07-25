import fs from "fs";
import path from "path";
import type {
  GitFileStatus,
  GitReviewSnapshot,
  GitReviewState,
  GitWorkingReviewCheck,
} from "../shared/ipc.js";
import { exec } from "./exec.js";
import { loadFileReviews, setFileReview, type FileReviewRecord } from "./file-reviews.js";
import { resolveGitReviewBase } from "./git.js";
import { parseNumstatZ, parsePorcelainLine } from "./git-status.js";
import {
  baseOidForLayer,
  blobOid,
  loadRawDiff,
  MISSING_BLOB_OID,
  normalizeOid,
  rawEntryMap,
} from "./review-fingerprint.js";

function parseIndexOids(output: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const record of output.split("\0")) {
    if (!record) {
      continue;
    }
    const separator = record.indexOf("\t");
    if (separator < 0) {
      throw new Error(`Unexpected index record: ${JSON.stringify(record)}`);
    }
    const [mode, oid, stage] = record.slice(0, separator).split(" ");
    if (!mode || !oid || !stage) {
      throw new Error(`Unexpected index record: ${JSON.stringify(record)}`);
    }
    if (stage === "0") {
      result.set(record.slice(separator + 1), oid);
    }
  }
  return result;
}

async function worktreeBlobOid(cwd: string, filePath: string): Promise<string> {
  let content: Buffer;
  try {
    content = await fs.promises.readFile(path.join(cwd, filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return MISSING_BLOB_OID;
    }
    throw error;
  }
  return blobOid(content);
}

function isReviewed(
  record: FileReviewRecord | undefined,
  baseOid: string,
  approvedOid: string,
): boolean {
  return record?.baseOid === baseOid && record.approvedOid === approvedOid;
}

export async function getReviewState(cwd: string): Promise<GitReviewState> {
  const base = await resolveGitReviewBase(cwd);
  if (!base) {
    return { kind: "no-base" };
  }

  const [
    committedEntries,
    committedNumstat,
    indexEntries,
    worktreeEntries,
    statusOutput,
    indexOutput,
  ] = await Promise.all([
    loadRawDiff(cwd, base.mergeBase, "head"),
    exec("git", ["diff", "--numstat", "--find-renames", "-z", base.mergeBase, "HEAD"], cwd),
    loadRawDiff(cwd, base.mergeBase, "index"),
    loadRawDiff(cwd, base.mergeBase, "worktree"),
    exec("git", ["status", "--porcelain", "-uall"], cwd),
    exec("git", ["ls-files", "-s", "-z"], cwd),
  ]);

  const reviews = loadFileReviews(cwd);
  const committedStats = parseNumstatZ(committedNumstat);
  const committedFiles: GitFileStatus[] = committedEntries.map((entry) => {
    const baseOid = normalizeOid(entry.srcOid);
    const approvedOid = normalizeOid(entry.dstOid);
    return {
      path: entry.path,
      status: entry.status[0] ?? entry.status,
      lineStat: committedStats.get(entry.path),
      reviewed: isReviewed(reviews.get(entry.path), baseOid, approvedOid),
    };
  });

  const pathStates = statusOutput
    .split("\n")
    .map(parsePorcelainLine)
    .filter(
      (entry): entry is NonNullable<typeof entry> =>
        entry !== null &&
        !entry.ignored &&
        !entry.conflicted &&
        Boolean(entry.indexStatus || entry.worktreeStatus),
    );
  const indexOids = parseIndexOids(indexOutput);
  const indexDiffByPath = rawEntryMap(indexEntries);
  const worktreeDiffByPath = rawEntryMap(worktreeEntries);
  const worktreeOids = new Map(
    await Promise.all(
      pathStates.map(
        async (entry) => [entry.path, await worktreeBlobOid(cwd, entry.path)] as const,
      ),
    ),
  );

  const workingChecks: GitWorkingReviewCheck[] = pathStates.map((entry) => {
    const record = reviews.get(entry.path);
    const indexOid = indexOids.get(entry.path) ?? MISSING_BLOB_OID;
    const worktreeOid = worktreeOids.get(entry.path) ?? MISSING_BLOB_OID;
    const stagedBaseOid = baseOidForLayer(entry.path, indexOid, indexDiffByPath, false);
    const unstagedBaseOid = baseOidForLayer(
      entry.path,
      worktreeOid,
      worktreeDiffByPath,
      entry.worktreeStatus === "??",
    );
    return {
      path: entry.path,
      stagedReviewed: isReviewed(record, stagedBaseOid, indexOid),
      unstagedReviewed: isReviewed(record, unstagedBaseOid, worktreeOid),
    };
  });

  return {
    kind: "ready",
    baseBranch: base.branch,
    committedFiles,
    workingChecks,
  };
}

// 表示していた diff の snapshot をそのまま記録する。表示が古くなっていた場合は、
// 記録した内容がもうその層に無いため導出で checked にならない。
export function setFileReviewed(
  cwd: string,
  filePath: string,
  reviewed: boolean,
  snapshot: GitReviewSnapshot,
): void {
  setFileReview(
    cwd,
    filePath,
    reviewed ? { baseOid: snapshot.baseOid, approvedOid: snapshot.approvedOid } : null,
  );
}
