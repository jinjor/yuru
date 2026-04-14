import { execFile } from "child_process";

export function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const nextError = new Error(stderr.trim() || err.message);
        Object.assign(nextError, {
          code: (err as NodeJS.ErrnoException).code,
          cause: err,
        });
        reject(nextError);
        return;
      }
      resolve(stdout);
    });
  });
}

export function execBuffer(cmd: string, args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr.toString("utf-8").trim();
          const nextError = new Error(detail || err.message);
          Object.assign(nextError, {
            code: (err as NodeJS.ErrnoException).code,
            cause: err,
          });
          reject(nextError);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
