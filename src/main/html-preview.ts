import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { HtmlPreviewGrant } from "../shared/ipc.js";
import { isPathWithin } from "./worktree-identity.js";

export const HTML_PREVIEW_SCHEME = "yuru-preview";

// HTML は sandbox iframe で開くが、レスポンス側でも同じ制約を課す。ローカルの
// CSS / JavaScript とインラインの CSS / JavaScript だけを許可し、通信や埋め込みは許可しない。
// allow-same-origin は、preview に origin を与えて localStorage 等を例外にせず使わせるため。
// grant ごとに host が変わるので preview 同士も別 origin で、Yuru 本体とも別 origin のまま。
export const HTML_PREVIEW_CSP = [
  "sandbox allow-scripts allow-same-origin",
  "default-src 'none'",
  `script-src ${HTML_PREVIEW_SCHEME}: 'unsafe-inline'`,
  `style-src ${HTML_PREVIEW_SCHEME}: 'unsafe-inline'`,
  `img-src ${HTML_PREVIEW_SCHEME}: data:`,
  `font-src ${HTML_PREVIEW_SCHEME}: data:`,
  `media-src ${HTML_PREVIEW_SCHEME}: data:`,
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

interface StoredHtmlPreviewGrant {
  entryContent: Buffer;
  entryPath: string;
  root: string;
}

export interface HtmlPreviewResponse {
  body: Buffer;
  headers: Record<string, string>;
  status: number;
}

const contentTypes = new Map<string, string>([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function contentTypeFor(filePath: string): string {
  return contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function errorResponse(status: number, message: string): HtmlPreviewResponse {
  return {
    body: Buffer.from(message),
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": HTML_PREVIEW_CSP,
      "X-Content-Type-Options": "nosniff",
    },
    status,
  };
}

function decodeRequestPath(pathname: string): string | null {
  try {
    return pathname
      .split("/")
      .slice(1)
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

function resolveRelativePath(
  root: string,
  requestedPath: string,
): {
  absolutePath: string;
  relativePath: string;
} | null {
  if (requestedPath.includes("\0")) {
    return null;
  }
  const absolutePath = path.resolve(root, requestedPath);
  if (!isPathWithin(root, absolutePath) || absolutePath === root) {
    return null;
  }
  return {
    absolutePath,
    relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
  };
}

function encodeUrlPath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isFileNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "ENOTDIR")
  );
}

/**
 * HTML preview URL の host を、読み取りを許可する root ディレクトリへ対応付ける。
 * URL に実パスは含めない。preview が読めるのは root の内側だけで、release すると
 * 同じ URL からは何も読めなくなる。
 */
export class HtmlPreviewGrants {
  private readonly grants = new Map<string, StoredHtmlPreviewGrant>();

  async create(root: string, entryPath: string, entryContent: string): Promise<HtmlPreviewGrant> {
    const realRoot = await fs.promises.realpath(root);
    const resolvedEntry = resolveRelativePath(realRoot, entryPath);
    if (!resolvedEntry) {
      throw new Error("Invalid path");
    }

    const id = randomUUID();
    this.grants.set(id, {
      entryContent: Buffer.from(entryContent),
      entryPath: resolvedEntry.relativePath,
      root: realRoot,
    });
    return {
      id,
      url: `${HTML_PREVIEW_SCHEME}://${id}/${encodeUrlPath(resolvedEntry.relativePath)}`,
    };
  }

  release(id: string): void {
    this.grants.delete(id);
  }

  clear(): void {
    this.grants.clear();
  }

  async respond(requestUrl: string, method = "GET"): Promise<HtmlPreviewResponse> {
    if (method !== "GET") {
      return errorResponse(405, "Method not allowed");
    }

    const url = new URL(requestUrl);
    if (url.protocol !== `${HTML_PREVIEW_SCHEME}:`) {
      return errorResponse(404, "Not found");
    }
    const grant = this.grants.get(url.hostname);
    if (!grant) {
      return errorResponse(404, "Not found");
    }

    const requestedPath = decodeRequestPath(url.pathname);
    const resolved = requestedPath ? resolveRelativePath(grant.root, requestedPath) : null;
    if (!resolved) {
      return errorResponse(403, "Forbidden");
    }

    let body: Buffer;
    if (resolved.relativePath === grant.entryPath) {
      body = grant.entryContent;
    } else {
      let realPath: string;
      try {
        realPath = await fs.promises.realpath(resolved.absolutePath);
      } catch (error) {
        if (isFileNotFound(error)) {
          return errorResponse(404, "Not found");
        }
        throw error;
      }
      if (!isPathWithin(grant.root, realPath)) {
        return errorResponse(403, "Forbidden");
      }

      const stat = await fs.promises.stat(realPath);
      if (!stat.isFile()) {
        return errorResponse(404, "Not found");
      }
      body = await fs.promises.readFile(realPath);
    }

    return {
      body,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": HTML_PREVIEW_CSP,
        "Content-Type": contentTypeFor(resolved.relativePath),
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
      status: 200,
    };
  }
}
