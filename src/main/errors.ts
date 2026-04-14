import { AppError } from "../shared/ipc.js";

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
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return (
    maybeCode === "EACCES" ||
    maybeCode === "ENOENT" ||
    maybeCode === "ENOTDIR" ||
    maybeCode === "EISDIR" ||
    maybeCode === "EPERM"
  );
}

function isCommandNotFound(error: unknown, detail?: string): boolean {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
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
