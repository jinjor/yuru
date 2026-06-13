import type { GitFileStatus, GitLineStat } from "../../../shared/ipc";

export interface ChangeSection {
  key: "conflicted" | "staged" | "unstaged";
  label: "Conflicted" | "Staged" | "Unstaged";
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
  conflictedFiles,
  stagedFiles,
  unstagedFiles,
}: {
  conflictedFiles: readonly GitFileStatus[];
  stagedFiles: readonly GitFileStatus[];
  unstagedFiles: readonly GitFileStatus[];
}): ChangeSection[] {
  const sections: ChangeSection[] = [];

  if (conflictedFiles.length > 0) {
    sections.push({
      key: "conflicted",
      label: "Conflicted",
      files: conflictedFiles,
      totalLineStat: sumLineStats(conflictedFiles),
    });
  }

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
