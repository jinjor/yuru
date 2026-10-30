// Node のシステムエラー (ENOENT などのエラーコードを持つエラー) か。
// child_process の exec/execFile のエラーは code に終了コードの数値が入るので、文字列の code だけを認める。
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}
