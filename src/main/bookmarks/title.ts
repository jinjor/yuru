import os from "os";
import { exec } from "../exec.js";

export function extractGitHubIssueOrPr(url: string) {
  const parsed = URL.parse(url);
  const match =
    parsed?.hostname === "github.com"
      ? parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\/?$/)
      : null;
  return match ? { owner: match[1], repo: match[2], number: match[3] } : null;
}

export function parseHtmlTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (!title) {
    return null;
  }
  return (
    title
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
        String.fromCodePoint(parseInt(code, 16)),
      )
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => entities[entity] ?? entity)
      .trim() || null
  );
}

export async function resolveUrlTitle(url: string): Promise<string | null> {
  const github = extractGitHubIssueOrPr(url);
  if (github) {
    try {
      const title = await exec(
        "gh",
        ["api", `repos/${github.owner}/${github.repo}/issues/${github.number}`, "--jq", ".title"],
        os.homedir(),
      );
      if (title.trim()) {
        return title.trim();
      }
    } catch {
      // Public GitHub pages can still be resolved by the generic request below.
    }
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      return null;
    }
    return parseHtmlTitle((await response.text()).slice(0, 1_000_000));
  } catch {
    return null;
  }
}

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
