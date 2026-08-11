import type { AppError, AppErrorNotice, AppErrorSeverity } from "../../shared/ipc.js";

const MAX_ERRORS = 25;
const notices: AppErrorNotice[] = [];

// 記録の変化 (追加・まとめ・削除・全消去) を丸ごと通知する。renderer への push は
// この 1 本に集約し、購読側 (main/index.ts) が現在の一覧をそのまま送る。
type ErrorNoticesListener = (notices: AppErrorNotice[]) => void;
let noticesListener: ErrorNoticesListener | null = null;

export function setErrorNoticesListener(listener: ErrorNoticesListener): void {
  noticesListener = listener;
}

function notifyChanged(): void {
  noticesListener?.(listErrorNotices());
}

function logNotice(severity: AppErrorSeverity, error: AppError): void {
  const log = severity === "error" ? console.error : console.warn;
  if (error.detail) {
    log(`[Yuru] ${error.message}`, error.detail);
    return;
  }
  log(`[Yuru] ${error.message}`);
}

function record(error: AppError, severity: AppErrorSeverity): AppErrorNotice {
  logNotice(severity, error);

  // 最新の行と同一内容なら新しい行を作らず 1 行にまとめる (DevTools と同じ「連続」の定義)。
  const newest = notices[0];
  if (
    newest &&
    newest.severity === severity &&
    newest.message === error.message &&
    newest.detail === error.detail
  ) {
    newest.count += 1;
    newest.timestamp = Date.now();
    notifyChanged();
    return newest;
  }

  const notice: AppErrorNotice = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    message: error.message,
    detail: error.detail,
    count: 1,
    timestamp: Date.now(),
  };
  notices.unshift(notice);
  if (notices.length > MAX_ERRORS) {
    notices.length = MAX_ERRORS;
  }
  notifyChanged();
  return notice;
}

export function listErrorNotices(): AppErrorNotice[] {
  return notices.map((notice) => ({ ...notice }));
}

export function recordAppError(error: AppError): AppErrorNotice {
  return record(error, "error");
}

export function recordAppWarning(error: AppError): AppErrorNotice {
  return record(error, "warning");
}

export function dismissErrorNotice(id: string): boolean {
  const index = notices.findIndex((notice) => notice.id === id);
  if (index === -1) {
    return false;
  }
  notices.splice(index, 1);
  notifyChanged();
  return true;
}

export function clearErrorNotices(): boolean {
  if (notices.length === 0) {
    return false;
  }
  notices.length = 0;
  notifyChanged();
  return true;
}
