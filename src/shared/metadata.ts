export interface RepoMetadata {
  id: string;
  repoPath: string;
}

export interface YuruMetadata {
  repos: RepoMetadata[];
}
