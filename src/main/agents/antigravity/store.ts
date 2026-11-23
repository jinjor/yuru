import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { antigravitySummariesDbPath } from "./paths.js";

// agy keeps its conversation index in a SQLite database
// (~/.gemini/antigravity-cli/conversation_summaries.db). It is an internal
// store rather than a documented contract, so every read is contained: a
// missing, locked, or schema-drifted database returns the fallback instead of
// taking down the other providers' session listing with it.

export interface AntigravitySessionRow {
  agentSessionId: string;
  // First workspace directory recorded for the conversation (used as resume cwd).
  workDir: string;
  // All workspace directories attached to the conversation.
  workspaceDirs: string[];
  title: string;
  preview: string;
  lastModifiedAt: number;
}

const warnedErrors = new Set<string>();
function warnStoreRead(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (warnedErrors.has(message)) {
    return;
  }
  warnedErrors.add(message);
  console.warn("[Yuru] failed to read the antigravity session store", error);
}

// Opens the store read-only, runs `run`, and always closes. Missing or
// unreadable stores yield `fallback`; sqlite-level failures (locked, schema
// drift) are logged once per distinct message and also yield `fallback`.
export function withAntigravityStore<T>(run: (db: DatabaseSync) => T, fallback: T): T {
  const dbPath = antigravitySummariesDbPath();
  if (!fs.existsSync(dbPath)) {
    return fallback;
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    warnStoreRead(error);
    return fallback;
  }
  try {
    return run(db);
  } catch (error) {
    warnStoreRead(error);
    return fallback;
  } finally {
    try {
      db.close();
    } catch {
      // A close failure leaves nothing usable behind; the process GC reclaims it.
    }
  }
}

function readSummaryColumns(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(conversation_summaries)`).all() as unknown[];
  const columns = new Set<string>();
  for (const row of rows) {
    const name = (row as { name?: unknown })?.name;
    if (typeof name === "string") {
      columns.add(name);
    }
  }
  return columns;
}

// Exclude subagent conversations and killed conversations when those columns
// exist so Yuru only lists top-level resumable user sessions.
function visibleSessionConditions(columns: ReadonlySet<string>): string[] {
  const conditions: string[] = [];
  if (columns.has("parent_conversation_id")) {
    conditions.push("parent_conversation_id = ''");
  }
  if (columns.has("nesting_depth")) {
    conditions.push("nesting_depth = 0");
  }
  if (columns.has("killed")) {
    conditions.push("killed = 0");
  }
  return conditions;
}

export function readSessionRows(db: DatabaseSync): AntigravitySessionRow[] {
  const columns = readSummaryColumns(db);
  if (!columns.has("conversation_id") || !columns.has("workspace_uris")) {
    return [];
  }
  const select = ["conversation_id", "workspace_uris", "title", "preview", "last_modified_time"]
    .filter((column) => columns.has(column))
    .join(", ");
  const conditions = visibleSessionConditions(columns);
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT ${select} FROM conversation_summaries${where}`)
    .all() as unknown[];
  return rows.flatMap((row) => {
    const parsed = parseSessionRow(row);
    return parsed ? [parsed] : [];
  });
}

export function readSessionRow(
  db: DatabaseSync,
  agentSessionId: string,
): AntigravitySessionRow | null {
  const columns = readSummaryColumns(db);
  if (!columns.has("conversation_id") || !columns.has("workspace_uris")) {
    return null;
  }
  const select = ["conversation_id", "workspace_uris", "title", "preview", "last_modified_time"]
    .filter((column) => columns.has(column))
    .join(", ");
  const conditions = ["conversation_id = ?", ...visibleSessionConditions(columns)];
  const row = db
    .prepare(`SELECT ${select} FROM conversation_summaries WHERE ${conditions.join(" AND ")}`)
    .get(agentSessionId);
  return parseSessionRow(row);
}

export function listSessionIds(db: DatabaseSync): Set<string> {
  const columns = readSummaryColumns(db);
  if (!columns.has("conversation_id")) {
    return new Set();
  }
  const rows = db.prepare(`SELECT conversation_id FROM conversation_summaries`).all() as unknown[];
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null) {
      const id = (row as { conversation_id?: unknown }).conversation_id;
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }
  return ids;
}

export function hasSessionRow(db: DatabaseSync, agentSessionId: string): boolean {
  const columns = readSummaryColumns(db);
  if (!columns.has("conversation_id")) {
    return false;
  }
  const conditions = ["conversation_id = ?", ...visibleSessionConditions(columns)];
  const row = db
    .prepare(`SELECT 1 AS one FROM conversation_summaries WHERE ${conditions.join(" AND ")}`)
    .get(agentSessionId);
  return row !== undefined;
}

function parseSessionRow(row: unknown): AntigravitySessionRow | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const maybe = row as {
    conversation_id?: unknown;
    workspace_uris?: unknown;
    title?: unknown;
    preview?: unknown;
    last_modified_time?: unknown;
  };
  if (typeof maybe.conversation_id !== "string" || typeof maybe.workspace_uris !== "string") {
    return null;
  }
  const workspaceDirs = parseWorkspaceUris(maybe.workspace_uris);
  if (workspaceDirs.length === 0) {
    return null;
  }
  return {
    agentSessionId: maybe.conversation_id,
    workDir: workspaceDirs[0],
    workspaceDirs,
    title: typeof maybe.title === "string" ? maybe.title : "",
    preview: typeof maybe.preview === "string" ? maybe.preview : "",
    lastModifiedAt: parseAntigravityTimestamp(maybe.last_modified_time),
  };
}

function parseWorkspaceUris(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const dirs: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || !item) {
      continue;
    }
    const dir = uriToLocalPath(item);
    if (dir) {
      dirs.push(dir);
    }
  }
  return dirs;
}

function uriToLocalPath(uri: string): string | null {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return null;
    }
  }
  return uri.startsWith("/") ? uri : null;
}

function parseAntigravityTimestamp(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || !raw) {
    return 0;
  }
  // SQLite datetime strings use a space separator (e.g. "2026-11-23 15:58:07.166553+00:00").
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
