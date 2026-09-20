import fs from "fs";
import path from "path";
import { getApplicationsDir, getManagedRepoDir } from "../yuru-paths.js";

export type CanUpdateYuru = { ok: true } | { ok: false; reason: string };

export interface RunningAppContext {
  platform: string;
  packaged: boolean;
  // Electron の app.getAppPath()。packaged では <Yuru.app>/Contents/Resources/app を指す。
  appPath: string;
}

// 更新は `~/Applications/Yuru.app` を丸ごと差し替える。差し替えられる側が動いたままだと
// 壊れるので、いま動いているのがその app 自身のときだけ更新できる。
// 開発版 (npm run app:restart) は node_modules の Electron.app を worktree の path を
// 引数にして起動するため packaged にならず、ここで弾かれる。
export function canUpdateYuru(context: RunningAppContext): CanUpdateYuru {
  if (context.platform !== "darwin") {
    return { ok: false, reason: "Updating Yuru from here is supported on macOS only." };
  }
  if (!context.packaged) {
    return { ok: false, reason: "Yuru is running from a development build." };
  }

  const installedAppPath = path.join(
    getApplicationsDir(),
    "Yuru.app",
    "Contents",
    "Resources",
    "app",
  );
  if (path.resolve(context.appPath) !== path.resolve(installedAppPath)) {
    return { ok: false, reason: `Yuru is not running from ${installedAppPath}.` };
  }
  if (!fs.existsSync(path.join(getManagedRepoDir(), ".git"))) {
    return { ok: false, reason: `${getManagedRepoDir()} is not a Git repository.` };
  }

  return { ok: true };
}
