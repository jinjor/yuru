import { RepoMetadata } from "../shared/metadata.js";

// Dummy metadata for V2 migration step 3.
// Replaced by a real persistent store when `yuru add` lands in step 4.
const DUMMY_REPOS: RepoMetadata[] = [
  { id: "dummy-1", repoPath: "/path/to/example-repo-a" },
  { id: "dummy-2", repoPath: "/path/to/example-repo-b" },
];

export function loadRepos(): RepoMetadata[] {
  return DUMMY_REPOS;
}
