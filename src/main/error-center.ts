import { AppError, AppErrorNotice } from "../shared/ipc.js";

const MAX_ERRORS = 25;
const notices: AppErrorNotice[] = [];

function toNotice(error: AppError): AppErrorNotice {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: error.message,
    detail: error.detail,
    timestamp: Date.now(),
  };
}

export function listErrorNotices(): AppErrorNotice[] {
  return [...notices];
}

export function recordAppError(error: AppError): AppErrorNotice {
  const notice = toNotice(error);
  notices.unshift(notice);
  if (notices.length > MAX_ERRORS) {
    notices.length = MAX_ERRORS;
  }
  return notice;
}

export function dismissErrorNotice(id: string): boolean {
  const index = notices.findIndex((notice) => notice.id === id);
  if (index === -1) {
    return false;
  }
  notices.splice(index, 1);
  return true;
}

export function clearErrorNotices(): boolean {
  if (notices.length === 0) {
    return false;
  }
  notices.length = 0;
  return true;
}
