import os from "os";
import path from "path";

export function getYuruHome(): string {
  return process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
}

// `yuru latest` が更新する checkout。CLI (scripts/yuru-cli) と同じ env を見る。
export function getManagedRepoDir(): string {
  return process.env.YURU_REPO_DIR ?? path.join(getYuruHome(), "repo");
}

// `Yuru.app` の置き場。CLI (scripts/yuru-cli) と同じ env を見る。
export function getApplicationsDir(): string {
  return process.env.YURU_APPLICATIONS_DIR ?? path.join(os.homedir(), "Applications");
}
