import type { GitFileStatus } from "../../../shared/ipc";

export interface ChangeSection {
  key: "staged" | "unstaged";
  label: "Staged" | "Unstaged";
  files: readonly GitFileStatus[];
}

export function buildChangeSections({
  stagedFiles,
  unstagedFiles,
}: {
  stagedFiles: readonly GitFileStatus[];
  unstagedFiles: readonly GitFileStatus[];
}): ChangeSection[] {
  const sections: ChangeSection[] = [];

  if (stagedFiles.length > 0) {
    sections.push({
      key: "staged",
      label: "Staged",
      files: stagedFiles,
    });
  }

  if (unstagedFiles.length > 0) {
    sections.push({
      key: "unstaged",
      label: "Unstaged",
      files: unstagedFiles,
    });
  }

  return sections;
}
