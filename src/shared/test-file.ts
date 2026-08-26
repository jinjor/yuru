// テストファイルの命名規約。言語ごとに慣習が異なるため、
// ファイル名だけで確実に判定できる言語に限定している。
const testFileNamePatterns = [
  // JavaScript / TypeScript: Jest・Vitest が既定で収集するパターン。
  /\.(test|spec)\.(c|m)?[jt]sx?$/,
  // Go: ツールチェーンが強制する規約。
  /_test\.go$/,
  // Python: pytest の python_files 既定値。
  /^test_.+\.py$/,
  /_test\.py$/,
];

// path がテストファイルかどうかを返す。ディレクトリ構成は言語やプロジェクトごとに
// 分かれていて規約にできないので、ファイル名だけを見る。
export function isTestFile(filePath: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
  return testFileNamePatterns.some((pattern) => pattern.test(fileName));
}
