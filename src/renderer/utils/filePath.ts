// ルートのディレクトリからの相対パスと、絶対パスとの変換。パスの区切りは "/"。

// absolutePath が rootPath の下にあれば rootPath からの相対パス (rootPath 自身は "")。外なら null。
export function toRootRelativePath(rootPath: string, absolutePath: string): string | null {
  if (absolutePath === rootPath) {
    return "";
  }
  const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : null;
}

export function toAbsolutePath(rootPath: string, relativePath: string): string {
  if (relativePath === "") {
    return rootPath;
  }
  return rootPath.endsWith("/") ? `${rootPath}${relativePath}` : `${rootPath}/${relativePath}`;
}

// 表示用に、ディレクトリ名と親のパスに分ける。親がルート ("/") のときの parent は "/"。
export function splitDirectoryPath(absolutePath: string): { name: string; parent: string } {
  const separatorIndex = absolutePath.lastIndexOf("/");
  return {
    name: absolutePath.slice(separatorIndex + 1),
    parent: separatorIndex === 0 ? "/" : absolutePath.slice(0, separatorIndex),
  };
}
