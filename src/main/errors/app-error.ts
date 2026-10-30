import type { AppError } from "../../shared/ipc.js";
import { isErrnoException } from "./utils.js";

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message || undefined;
  }
  if (typeof error === "string") {
    return error || undefined;
  }
  return undefined;
}

function isFilesystemError(error: unknown): boolean {
  if (!isErrnoException(error)) {
    return false;
  }
  return (
    error.code === "EACCES" ||
    error.code === "ENOENT" ||
    error.code === "ENOTDIR" ||
    error.code === "EISDIR" ||
    error.code === "EPERM"
  );
}

function isCommandNotFound(error: unknown, detail?: string): boolean {
  if (isErrnoException(error) && error.code === "ENOENT") {
    return true;
  }

  if (!detail) {
    return false;
  }

  return (
    detail.includes("ENOENT") ||
    detail.includes("posix_spawn failed") ||
    detail.includes("No such file or directory")
  );
}

export function toAppError(error: unknown, options?: { command?: string }): AppError {
  const detail = errorDetail(error);

  if (detail === "Invalid path") {
    return {
      code: "invalid_path",
      message: "Invalid path.",
    };
  }

  if (options?.command && isCommandNotFound(error, detail)) {
    return {
      code: "command_not_found",
      message: `Yuru could not find the ${options.command} command.`,
      detail,
    };
  }

  if (options?.command === "git") {
    const message = detail || "Git command failed.";
    return {
      code: "git_failed",
      message,
    };
  }

  if (options?.command) {
    const message = detail || `${options.command} failed.`;
    return {
      code: "command_failed",
      message,
    };
  }

  if (isFilesystemError(error)) {
    const message = detail || "Filesystem operation failed.";
    return {
      code: "filesystem_failed",
      message,
    };
  }

  const message = detail || "Unknown error.";
  return {
    code: "unknown",
    message,
  };
}
