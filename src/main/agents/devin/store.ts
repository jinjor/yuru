import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import { devinSessionsDbPath } from "./paths.js";

// devin keeps its session store in a SQLite database (~/.local/share/devin/cli/
// sessions.db). It is an internal store rather than a documented contract, so
// every read is contained: a missing, locked, or schema-drifted database
// returns the empty result instead of taking down the other providers' session
// listing with it.

export interface DevinSessionRow {
  agentSessionId: string;
  // devin realpath-resolves the working directory before recording it
  // (e.g. /tmp becomes /private/tmp on macOS).
  workDir: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface DevinMessage {
  role: string;
  content: string;
}

// How many recent nodes to scan when looking for a session's last assistant
// message. devin re-records the message chain on top of earlier nodes, so the
// latest assistant text sits within the tail even in long sessions.
const LAST_MESSAGE_SCAN_LIMIT = 200;

const warnedErrors = new Set<string>();
function warnStoreRead(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (warnedErrors.has(message)) {
    return;
  }
  warnedErrors.add(message);
  console.warn("[Yuru] failed to read the devin session store", error);
}

// Opens the store read-only, runs `run`, and always closes. Missing or
// unreadable stores yield `fallback`; sqlite-level failures (locked, schema
// drift) are logged once per distinct message and also yield `fallback`.
export function withDevinStore<T>(run: (db: DatabaseSync) => T, fallback: T): T {
  const dbPath = devinSessionsDbPath();
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

// The columns the store actually has, so reads degrade on older/newer schemas
// instead of failing outright. `hidden` was added later; without it there is
// simply nothing to filter out.
function readSessionColumns(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(sessions)`).all() as unknown[];
  const columns = new Set<string>();
  for (const row of rows) {
    const name = (row as { name?: unknown })?.name;
    if (typeof name === "string") {
      columns.add(name);
    }
  }
  return columns;
}

export function readSessionRows(db: DatabaseSync): DevinSessionRow[] {
  const columns = readSessionColumns(db);
  if (!columns.has("id") || !columns.has("working_directory")) {
    return [];
  }
  const select = ["id", "working_directory", "title", "created_at", "last_activity_at"]
    .filter((column) => columns.has(column))
    .join(", ");
  const rows = db
    .prepare(`SELECT ${select} FROM sessions${columns.has("hidden") ? " WHERE hidden = 0" : ""}`)
    .all() as unknown[];
  return rows.flatMap((row) => {
    const parsed = parseSessionRow(row);
    return parsed ? [parsed] : [];
  });
}

function parseSessionRow(row: unknown): DevinSessionRow | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const maybe = row as {
    id?: unknown;
    working_directory?: unknown;
    title?: unknown;
    created_at?: unknown;
    last_activity_at?: unknown;
  };
  if (typeof maybe.id !== "string" || typeof maybe.working_directory !== "string") {
    return null;
  }
  return {
    agentSessionId: maybe.id,
    workDir: maybe.working_directory,
    title: typeof maybe.title === "string" ? maybe.title : "",
    // devin records timestamps in epoch seconds.
    createdAt: typeof maybe.created_at === "number" ? maybe.created_at * 1000 : 0,
    lastActivityAt: typeof maybe.last_activity_at === "number" ? maybe.last_activity_at * 1000 : 0,
  };
}

export function readSessionRow(db: DatabaseSync, agentSessionId: string): DevinSessionRow | null {
  const columns = readSessionColumns(db);
  if (!columns.has("id") || !columns.has("working_directory")) {
    return null;
  }
  const select = ["id", "working_directory", "title", "created_at", "last_activity_at"]
    .filter((column) => columns.has(column))
    .join(", ");
  const row = db.prepare(`SELECT ${select} FROM sessions WHERE id = ?`).get(agentSessionId);
  return parseSessionRow(row);
}

export function listSessionIds(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`SELECT id FROM sessions`).all() as unknown[];
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }
  return ids;
}

export function hasSessionRow(db: DatabaseSync, agentSessionId: string): boolean {
  const row = db.prepare(`SELECT 1 AS one FROM sessions WHERE id = ?`).get(agentSessionId);
  return row !== undefined;
}

export function parseMessage(raw: unknown): DevinMessage | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const maybe = raw as { role?: unknown; content?: unknown };
  if (typeof maybe.role !== "string") {
    return null;
  }
  return {
    role: maybe.role,
    content: typeof maybe.content === "string" ? maybe.content : "",
  };
}

// The latest assistant message with actual text, for session previews.
// Tool-call-only assistant nodes have an empty content and are skipped.
export function readLastAssistantMessage(
  db: DatabaseSync,
  agentSessionId: string,
): { text: string; timestamp: number } | null {
  const rows = db
    .prepare(
      `SELECT chat_message, created_at FROM message_nodes
       WHERE session_id = ? ORDER BY node_id DESC LIMIT ?`,
    )
    .all(agentSessionId, LAST_MESSAGE_SCAN_LIMIT) as unknown[];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const { chat_message: raw, created_at } = row as {
      chat_message?: unknown;
      created_at?: unknown;
    };
    if (typeof raw !== "string") {
      continue;
    }
    let message: DevinMessage | null;
    try {
      message = parseMessage(JSON.parse(raw));
    } catch {
      continue;
    }
    if (message?.role === "assistant" && message.content.trim() !== "") {
      return {
        text: message.content,
        timestamp: typeof created_at === "number" ? created_at * 1000 : 0,
      };
    }
  }
  return null;
}

// The contents of every user message recorded for the session, newest first.
export function readUserMessageContents(db: DatabaseSync, agentSessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT chat_message FROM message_nodes
       WHERE session_id = ?
         AND json_valid(chat_message)
         AND json_extract(chat_message, '$.role') = 'user'
       ORDER BY node_id DESC`,
    )
    .all(agentSessionId) as unknown[];
  const contents: string[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const raw = (row as { chat_message?: unknown }).chat_message;
    if (typeof raw !== "string") {
      continue;
    }
    try {
      const message = parseMessage(JSON.parse(raw));
      if (message) {
        contents.push(message.content);
      }
    } catch {
      // Ignore malformed message rows.
    }
  }
  return contents;
}

// User messages containing the worktree-context marker, grouped by session.
// Used to link repo-root-launched sessions to the worktree the injected
// context names.
export function readMarkerUserMessages(db: DatabaseSync, marker: string): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT session_id, chat_message FROM message_nodes
       WHERE instr(chat_message, ?) > 0
         AND json_valid(chat_message)
         AND json_extract(chat_message, '$.role') = 'user'`,
    )
    .all(marker) as unknown[];
  const contentsBySession = new Map<string, string[]>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const { session_id: sessionId, chat_message: raw } = row as {
      session_id?: unknown;
      chat_message?: unknown;
    };
    if (typeof sessionId !== "string" || typeof raw !== "string") {
      continue;
    }
    try {
      const message = parseMessage(JSON.parse(raw));
      if (message) {
        const contents = contentsBySession.get(sessionId) ?? [];
        contents.push(message.content);
        contentsBySession.set(sessionId, contents);
      }
    } catch {
      // Ignore malformed message rows.
    }
  }
  return contentsBySession;
}
