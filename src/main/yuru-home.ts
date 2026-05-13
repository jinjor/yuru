import os from "os";
import path from "path";

export function getYuruHome(): string {
  return process.env.YURU_HOME ?? path.join(os.homedir(), ".yuru");
}
