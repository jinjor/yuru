import fs from "fs";
import path from "path";
import { getYuruHome } from "../yuru-home.js";

interface FileReviewStore {
  worktrees: Record<string, Record<string, string>>;
}

export interface FileReviewRecord {
  baseOid: string;
  approvedOid: string;
}

function getFileReviewsPath(): string {
  return path.join(getYuruHome(), "file-reviews.json");
}

function parseStore(value: unknown): FileReviewStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File reviews must be a JSON object.");
  }
  const worktreesValue = (value as { worktrees?: unknown }).worktrees;
  if (!worktreesValue || typeof worktreesValue !== "object" || Array.isArray(worktreesValue)) {
    throw new Error("File reviews `worktrees` must be an object.");
  }

  const worktrees: Record<string, Record<string, string>> = {};
  for (const [worktreePath, filesValue] of Object.entries(worktreesValue)) {
    if (!filesValue || typeof filesValue !== "object" || Array.isArray(filesValue)) {
      throw new Error(`File reviews for "${worktreePath}" must be an object.`);
    }
    const files: Record<string, string> = {};
    for (const [filePath, fingerprint] of Object.entries(filesValue)) {
      if (typeof fingerprint !== "string") {
        throw new Error(`File review for "${filePath}" must be a string.`);
      }
      files[filePath] = fingerprint;
    }
    worktrees[worktreePath] = files;
  }
  return { worktrees };
}

function loadStore(): FileReviewStore {
  const storePath = getFileReviewsPath();
  if (!fs.existsSync(storePath)) {
    return { worktrees: {} };
  }
  return parseStore(JSON.parse(fs.readFileSync(storePath, "utf8")));
}

function saveStore(store: FileReviewStore): void {
  const storePath = getFileReviewsPath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

function parseFingerprint(fingerprint: string): FileReviewRecord {
  const separator = fingerprint.indexOf(":");
  if (separator < 0) {
    throw new Error("File review fingerprint must contain base and approved blob OIDs.");
  }
  const baseOid = fingerprint.slice(0, separator);
  const approvedOid = fingerprint.slice(separator + 1);
  if (!baseOid || !approvedOid) {
    throw new Error("File review fingerprint must contain base and approved blob OIDs.");
  }
  return { baseOid, approvedOid };
}

export function loadFileReviews(worktreePath: string): Map<string, FileReviewRecord> {
  const files = loadStore().worktrees[path.resolve(worktreePath)] ?? {};
  return new Map(
    Object.entries(files).map(([filePath, fingerprint]) => [
      filePath,
      parseFingerprint(fingerprint),
    ]),
  );
}

export function setFileReview(
  worktreePath: string,
  filePath: string,
  record: FileReviewRecord | null,
): void {
  const store = loadStore();
  const worktreeKey = path.resolve(worktreePath);
  const files = store.worktrees[worktreeKey] ?? {};

  if (record) {
    files[filePath] = `${record.baseOid}:${record.approvedOid}`;
    store.worktrees[worktreeKey] = files;
  } else {
    delete files[filePath];
    if (Object.keys(files).length === 0) {
      delete store.worktrees[worktreeKey];
    } else {
      store.worktrees[worktreeKey] = files;
    }
  }
  saveStore(store);
}

export function removeFileReviews(worktreePath: string): void {
  const store = loadStore();
  const worktreeKey = path.resolve(worktreePath);
  if (!(worktreeKey in store.worktrees)) {
    return;
  }
  delete store.worktrees[worktreeKey];
  saveStore(store);
}
