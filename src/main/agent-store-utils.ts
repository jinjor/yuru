import fs from "fs";
import path from "path";

export async function readTextFileIfExists(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.promises.readFile(filePath, "utf-8");
}

function parseJsonLines(content: string): unknown[] {
  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function parseJsonLinesAs<T>(
  content: string,
  parser: (entry: unknown) => T | null,
): T[] {
  return parseJsonLines(content).flatMap((entry) => {
    const parsed = parser(entry);
    return parsed ? [parsed] : [];
  });
}

export async function listFilesRecursive(dirPath: string): Promise<string[]> {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await listFilesRecursive(nextPath)));
    } else if (entry.isFile()) {
      filePaths.push(nextPath);
    }
  }
  return filePaths;
}
