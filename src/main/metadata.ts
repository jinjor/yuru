import fs from "fs";
import os from "os";
import path from "path";
import { RepoMetadata, YuruMetadata } from "../shared/metadata.js";

function getYuruHome(): string {
  return process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
}

function getMetadataPath(): string {
  return process.env.YURU_METADATA_PATH ?? path.join(getYuruHome(), "metadata.json");
}

function parseMetadata(value: unknown): YuruMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Yuru metadata must be a JSON object.");
  }
  const maybeMetadata = value as { repos?: unknown };
  if (maybeMetadata.repos === undefined) {
    return { repos: [] };
  }
  if (!Array.isArray(maybeMetadata.repos)) {
    throw new Error("Yuru metadata `repos` must be an array.");
  }
  for (const repo of maybeMetadata.repos) {
    if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
      throw new Error("Yuru metadata repo entries must be objects.");
    }
    const maybeRepo = repo as { id?: unknown; repoPath?: unknown };
    if (typeof maybeRepo.id !== "string" || typeof maybeRepo.repoPath !== "string") {
      throw new Error("Yuru metadata repo entries must have string id and repoPath.");
    }
  }
  return { repos: maybeMetadata.repos as RepoMetadata[] };
}

export function loadMetadata(): YuruMetadata {
  const metadataPath = getMetadataPath();
  if (!fs.existsSync(metadataPath)) {
    return { repos: [] };
  }
  return parseMetadata(JSON.parse(fs.readFileSync(metadataPath, "utf8")));
}

export function loadRepos(): RepoMetadata[] {
  return loadMetadata().repos;
}
