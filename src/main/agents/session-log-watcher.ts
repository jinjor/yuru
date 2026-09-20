import type { SessionPreview } from "./agent.js";
import { IncrementalJsonlReader } from "./incremental-jsonl-reader.js";

// provider adapter が会話ログの 1 record から変換した assistant のメッセージ。
export interface PreviewMessage {
  text: string;
  timestamp: number;
}

interface SessionLog {
  reader: IncrementalJsonlReader;
  preview: SessionPreview | null;
}

// セッションの会話ログ (JSONL) を物理ファイルごとに 1 つの reader で増分読み取りし、
// assistant の最新メッセージで preview を更新する。
export class SessionLogWatcher {
  private readonly logs = new Map<string, SessionLog>();
  private readonly parseEntry: (entry: unknown) => PreviewMessage | null;

  constructor(parseEntry: (entry: unknown) => PreviewMessage | null) {
    this.parseEntry = parseEntry;
  }

  async read(filePath: string): Promise<SessionPreview | null> {
    const log = this.getLog(filePath);
    // 初回とファイル置換/truncate 後は末尾スキャンで最新の assistant message だけを拾い、
    // 全件走査を避ける。
    const result = await log.reader.read((entry) => {
      const message = this.parseEntry(entry);
      return message && normalizePreviewText(message.text) ? message : null;
    });
    if (result === null) {
      log.preview = null;
      return null;
    }
    if (result.tailEntry !== undefined) {
      log.preview = result.tailEntry
        ? {
            lastMessage: normalizePreviewText(result.tailEntry.text),
            timestamp: result.tailEntry.timestamp,
          }
        : null;
      return log.preview;
    }

    for (const entry of result.entries) {
      const message = this.parseEntry(entry);
      if (!message) {
        continue;
      }
      const lastMessage = normalizePreviewText(message.text);
      if (lastMessage && (!log.preview || message.timestamp >= log.preview.timestamp)) {
        log.preview = {
          lastMessage,
          timestamp: message.timestamp,
        };
      }
    }
    return log.preview;
  }

  private getLog(filePath: string): SessionLog {
    let log = this.logs.get(filePath);
    if (!log) {
      log = {
        reader: new IncrementalJsonlReader(filePath),
        preview: null,
      };
      this.logs.set(filePath, log);
    }
    return log;
  }
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
