import { createHash } from "crypto";
import type { GitReviewLayer } from "../shared/ipc.js";
import { exec } from "./exec.js";
import { parseRawDiffZ, type RawDiffEntry } from "./git-status.js";

export const MISSING_BLOB_OID = "-";

export function blobOid(content: Buffer | null): string {
  if (content === null) {
    return MISSING_BLOB_OID;
  }
  return createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");
}

export function normalizeOid(oid: string): string {
  return /^0+$/.test(oid) ? MISSING_BLOB_OID : oid;
}

export function rawEntryMap(entries: readonly RawDiffEntry[]): Map<string, RawDiffEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

export async function loadRawDiff(
  cwd: string,
  mergeBase: string,
  layer: GitReviewLayer,
): Promise<RawDiffEntry[]> {
  const rangeArgs =
    layer === "head"
      ? [mergeBase, "HEAD"]
      : layer === "index"
        ? ["--cached", mergeBase]
        : [mergeBase];
  const output = await exec(
    "git",
    ["diff", "--raw", "--find-renames", "--no-abbrev", "-z", ...rangeArgs],
    cwd,
  );
  return parseRawDiffZ(output);
}

// fork 元から見たこの file の blob OID。merge-base との diff に出ていれば元側の OID を使い、
// 出ていなければ fork 元と中身が同じなので、その層にある現在の内容の OID がそのまま元側になる。
// untracked は merge-base との diff に出ないが fork 元にも存在しないので、不在として扱う。
export function baseOidForLayer(
  filePath: string,
  currentOid: string,
  diffByPath: ReadonlyMap<string, RawDiffEntry>,
  untracked: boolean,
): string {
  const entry = diffByPath.get(filePath);
  if (entry) {
    return normalizeOid(entry.srcOid);
  }
  return untracked ? MISSING_BLOB_OID : currentOid;
}
