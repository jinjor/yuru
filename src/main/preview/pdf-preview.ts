import { randomUUID } from "crypto";
import fs from "fs";
import type { PdfPreviewGrant } from "../../shared/ipc.js";
import { MAX_PDF_PREVIEW_BYTES } from "../../shared/pdf-preview.js";

export const PDF_PREVIEW_SCHEME = "yuru-pdf";
export const PDF_VIEWER_ORIGIN = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";

// PDF は Chromium のビューアで開く。HTML として解釈させず、文書からの通信・フォームを拒否する。
const headers = {
  "Content-Type": "application/pdf",
  "Content-Disposition": "inline",
  // script-src はブラウザが内部生成する plugin 制御スクリプトにも適用されるため制限しない。
  // PDF 内の JavaScript は内蔵ビューアの javascript="block" で無効になる (E2E で確認する)。
  "Content-Security-Policy": "connect-src 'none'; form-action 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

/** 選択された PDF だけを配信する。ディレクトリや実パスはビューアに公開しない。 */
export class PdfPreviewGrants {
  private readonly grants = new Map<string, Buffer>();
  private generation = 0;

  async create(absolutePath: string): Promise<PdfPreviewGrant | null> {
    const generation = this.generation;
    // stat 後のファイル差替えで symlink を辿らない。open 済みの同じファイルだけを読む。
    const file = await fs.promises.open(
      absolutePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    let body: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_PDF_PREVIEW_BYTES) {
        return null;
      }
      // 読込み中にファイルが伸びても無制限にメモリを使わない。
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (bytesRead === 0) {
          break;
        }
        length += bytesRead;
      }
      if (length !== stat.size) {
        return null;
      }
      body = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
    if (generation !== this.generation) {
      return null;
    }
    const id = randomUUID();
    this.grants.set(id, body);
    return { id, url: `${PDF_PREVIEW_SCHEME}://${id}/document.pdf` };
  }

  release(id: string): void {
    this.grants.delete(id);
  }

  clear(): void {
    this.generation++;
    this.grants.clear();
  }

  isActive(url: string): boolean {
    if (!URL.canParse(url)) {
      return false;
    }
    const parsed = new URL(url);
    return (
      parsed.protocol === `${PDF_PREVIEW_SCHEME}:` &&
      parsed.pathname === "/document.pdf" &&
      this.grants.has(parsed.hostname)
    );
  }

  respond(url: string, method: string): Response {
    if (method !== "GET" || !this.isActive(url)) {
      return new Response("Not found", { status: 404 });
    }
    const body = this.grants.get(new URL(url).hostname)!;
    return new Response(new Uint8Array(body), { headers });
  }
}
