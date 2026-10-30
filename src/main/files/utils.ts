import fs from "fs";
import path from "path";
import { isErrnoException } from "../errors/utils.js";

// 区切りを "/" にそろえた相対パスにする。
export function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

// rootPath の下の relativePath を絶対パスにする。rootPath の外に出るパスは拒否する。
export function resolvePathUnderRoot(rootPath: string, relativePath = ""): string {
  const basePath = path.resolve(rootPath);
  const targetPath = relativePath ? path.resolve(basePath, relativePath) : basePath;
  const relative = path.relative(basePath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path");
  }
  return targetPath;
}

// 絶対パス指定の読み取り。不在・通常ファイルでない場合は null (呼び出し側で範囲を確認済みの前提)。
export async function readRegularFile(absolutePath: string): Promise<Buffer | null> {
  if ((await statRegularFile(absolutePath)) === null) {
    return null;
  }
  return await fs.promises.readFile(absolutePath);
}

// 中身を読まずに大きさと更新時刻だけ見る。不在・通常ファイルでない場合は null。
export async function statRegularFile(absolutePath: string): Promise<fs.Stats | null> {
  const stat = await statExisting(absolutePath);
  return stat?.isFile() ? stat : null;
}

// 不在は null。
export async function statExisting(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(targetPath);
  } catch (error) {
    // ENOTDIR はパス途中のコンポーネントがファイルだった場合。これも不在として扱う。
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}
