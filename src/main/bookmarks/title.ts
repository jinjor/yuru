import os from "os";
import { exec } from "../exec.js";
import { parseGitHubItemUrl } from "../github/github.js";

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
  const github = parseGitHubItemUrl(url);
  if (github?.kind === "number") {
    try {
      const title = await exec(
        "gh",
        ["api", `repos/${github.repoSlug}/issues/${github.number}`, "--jq", ".title"],
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
