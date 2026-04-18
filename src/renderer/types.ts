export interface PreviewSelection {
  kind: "diff" | "file";
  path: string;
  line?: number;
}
