import type { GitFileStatus, GitLineStat } from "../../../shared/ipc";

export interface ChangeSection {
  key: "staged" | "unstaged";
  label: "Staged" | "Unstaged";
  files: readonly GitFileStatus[];
  totalLineStat: GitLineStat;
}

function sumLineStats(files: readonly GitFileStatus[]): GitLineStat {
  let added = 0;
  let deleted = 0;
  for (const file of files) {
    added += file.lineStat?.added ?? 0;
    deleted += file.lineStat?.deleted ?? 0;
  }
  return { added, deleted };
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
      totalLineStat: sumLineStats(stagedFiles),
    });
  }

  if (unstagedFiles.length > 0) {
    sections.push({
      key: "unstaged",
      label: "Unstaged",
      files: unstagedFiles,
      totalLineStat: sumLineStats(unstagedFiles),
    });
  }

  return sections;
}
