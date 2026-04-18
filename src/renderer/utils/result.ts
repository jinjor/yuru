import type { Result } from "../../shared/ipc";

export function resultDataOrNull<T>(result: Result<T>): T | null {
  return result.ok ? result.data : null;
}
