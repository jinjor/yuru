import type { SessionPreview } from "./agent.js";
import { IncrementalJsonlReader } from "./incremental-jsonl-reader.js";

// provider adapter が会話ログの 1 record から変換した user / assistant のメッセージ。
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export type SessionMessageListener = (messages: readonly string[]) => void;

interface SessionLog {
  reader: IncrementalJsonlReader;
  preview: SessionPreview | null;
  listeners: Set<SessionMessageListener>;
}

// セッションの会話ログ (JSONL) を物理ファイルごとに 1 つの reader で増分読み取りし、
// preview の更新と bookmark 取得側への通知に共有する。listener は複数登録でき、
// 読み取った batch は全 listener に通知する。
export class SessionLogWatcher {
  private readonly logs = new Map<string, SessionLog>();
  private readonly parseEntry: (entry: unknown) => ConversationMessage | null;

  constructor(parseEntry: (entry: unknown) => ConversationMessage | null) {
    this.parseEntry = parseEntry;
  }

  async read(filePath: string): Promise<SessionPreview | null> {
    const log = this.getLog(filePath);
    const result = await log.reader.read();
    if (result === null) {
      log.preview = null;
      return null;
    }
    if (result.reset) {
      // ログファイルの置換・truncate。過去 URL や削除済み URL の復活を防ぐため、
      // この batch は通知せず preview も先頭から再構築する。
      log.preview = null;
    }

    const messages = result.entries.flatMap((entry) => {
      const message = this.parseEntry(entry);
      return message ? [message] : [];
    });
    for (const message of messages) {
      const lastMessage = normalizePreviewText(message.text);
      if (
        message.role === "assistant" &&
        lastMessage &&
        (!log.preview || message.timestamp >= log.preview.timestamp)
      ) {
        log.preview = {
          lastMessage,
          timestamp: message.timestamp,
        };
      }
    }
    if (!result.reset && messages.length > 0) {
      const texts = messages.map((message) => message.text);
      for (const listener of log.listeners) {
        listener(texts);
      }
    }
    return log.preview;
  }

  async watch(
    filePath: string,
    includeExistingMessages: boolean,
    listener: SessionMessageListener,
  ): Promise<() => void> {
    const log = this.getLog(filePath);
    // 登録前に共有 reader を現在位置まで進める。includeExistingMessages=false では
    // これ以降に追記されたメッセージだけが届く。
    await this.read(filePath);
    log.listeners.add(listener);
    if (includeExistingMessages) {
      // 過去分の再生で共有 reader を巻き戻すと他の listener にも再通知されるため、
      // 使い捨ての reader で先頭から読み、この listener にだけ渡す。
      const result = await new IncrementalJsonlReader(filePath).read();
      const texts = (result?.entries ?? []).flatMap((entry) => {
        const message = this.parseEntry(entry);
        return message ? [message.text] : [];
      });
      if (texts.length > 0 && log.listeners.has(listener)) {
        listener(texts);
      }
    }
    return () => {
      log.listeners.delete(listener);
    };
  }

  private getLog(filePath: string): SessionLog {
    let log = this.logs.get(filePath);
    if (!log) {
      log = {
        reader: new IncrementalJsonlReader(filePath),
        preview: null,
        listeners: new Set(),
      };
      this.logs.set(filePath, log);
    }
    return log;
  }
}

function normalizePreviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
