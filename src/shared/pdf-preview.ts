export const MAX_PDF_PREVIEW_BYTES = 50 * 1024 * 1024;

export function isPdfPath(filePath: string): boolean {
  return /(?:^|\/)[^/]+\.pdf$/i.test(filePath);
}
