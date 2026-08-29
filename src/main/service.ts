import { shell } from "electron";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import * as pty from "node-pty";
import {
  attachPrimarySessionByPath,
  detachPrimarySessionByPath,
  savePrimarySessionOrder,
  saveRepoOrder,
  findRepoByPath,
  loadMetadata,
  loadRepos,
  loadTaskWorktrees,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} from "./repos/metadata.js";
import { removeFileReviews } from "./review/store.js";
import {
  addBookmarks,
  loadBookmarks,
  removeBookmark as removeStoredBookmark,
  removeBookmarks as removeStoredBookmarks,
  updateBookmarkTitle,
} from "./bookmarks/store.js";
import { resolveUrlTitle } from "./bookmarks/title.js";
import { findHttpUrls } from "../shared/http-url.js";
import {
  getReviewState as loadReviewState,
  setFileReviewed as saveFileReviewed,
} from "./review/review-state.js";
import { loadRepoList } from "./repos/repo-list.js";
import {
  loadStoredSessionPreview,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} from "./sessions/suggested.js";
import { isPathWithin, toWorktreeId } from "./worktree-identity.js";
import { getFileDocument, getGitDiffDocument as loadGitDiffDocument } from "./git/diff.js";
import { getCurrentBranch, getHeadSha, isSupportedGitRepo } from "./git/repo.js";
import { getGitPathStates as loadGitPathStates } from "./git/status.js";
import {
  branchExists,
  createWorktree,
  createWorktreeFromOriginBranch,
  fetchOriginBranch,
  isWorktreeDirty,
  listWorktrees,
  removeWorktree as removeGitWorktree,
  removeWorktreeForce as removeGitWorktreeForce,
  unlockWorktree as unlockGitWorktree,
} from "./git/worktree.js";
import {
  getImageDiffDocument as loadImageDiffDocument,
  getImageFileDocument,
} from "./preview/image-diff.js";
import { hasLiveProcessInWorktree, listLiveProcessesInWorktree } from "./repos/process-check.js";
import { getLastKnownGitHubPullRequest } from "./github/github.js";
import {
  listAllFiles as listAllRepoFiles,
  listFiles as listRepoFiles,
  readWorktreeFile as readRepoWorktreeFile,
  resolveHtmlPreviewEntry as resolveHtmlPreviewEntryPath,
  resolveRepoFile as resolveRepoFilePath,
  writeFile as writeRepoFile,
} from "./files/files.js";
import { addRecentFile, loadRecentFiles } from "./files/recent-files.js";
import { getAgent } from "./agents/registry.js";
import {
  exhaustedUntil,
  isRateLimitResetDue,
  nextResetDelayMs,
} from "./agents/rate-limit-window.js";
import {
  CODE_SEARCH_RESULT_LIMIT,
  createEmptyCodeSearchResult,
  isCodeSearchCancelledError,
  searchCode as runCodeSearch,
} from "./files/code-search.js";
import {
  type LaunchRequest,
  type PendingSession,
  type Agent,
  type WorktreeContext,
} from "./agents/agent.js";
import type {
  PendingTerminal,
  TerminalLaunchRequest,
  TerminalRuntimeKind,
  TerminalRuntimeInfo,
} from "./terminal/runtime.js";
import { FileTreeWatcher } from "./files/tree-watcher.js";
import {
  type AppError,
  type AppErrorNotice,
  type Bookmark,
  type CreatedTaskWorktree,
  type GitDiffScope,
  type Result,
  type SessionUpdate,
  type WorktreeProcessRef,
  type WorktreeRemovalPreparationOutcome,
  type WorktreeSessionSelection,
} from "../shared/ipc.js";
import {
  type AgentActivityState,
  type SessionProvider,
  type SuggestedWorktreeSession,
  toSessionKey,
  type RateLimitStop,
  type ProviderPlanUsage,
} from "../shared/session.js";
import { isFileNotFoundError, toAppError } from "./errors/app-error.js";
import {
  clearErrorNotices,
  dismissErrorNotice,
  listErrorNotices,
  recordAppError,
  recordAppWarning,
} from "./errors/center.js";
import { createTerminalEnv, type TerminalEnvOptions } from "./terminal/env.js";
import { deliverInitialInput } from "./terminal/initial-input.js";
import { isCursorPositionQuery, isCursorPositionReport } from "./terminal/cursor-position.js";
import { TerminalScreen } from "./terminal/screen.js";
import { createInteractiveShellLaunchCommand } from "./terminal/shell-launch.js";
import { findRepoByWorktreeId, findRepoByWorktreePath } from "./repos/find-repo.js";
import { saveTaskWorktreeOrder } from "./repos/worktree-order.js";
import {
  indexPrimaryWorktreePathsBySessionKey,
  indexTerminalRuntimeIdsByTaskWorktreePath,
  isUnresolvedProviderRuntime,
  resolveTerminalRuntimeTaskWorktreePath,
} from "./terminal/runtime-routing.js";

const STARTUP_OUTPUT_LIMIT = 4000;
// rate limit で断られたリクエストの続きを促す入力。直前のリクエストは agent 側の
// 記録に残っているので、何をするかは伝え直さない。
const RATE_LIMIT_RESUME_INPUT = "continue";
const ESCAPE = "\u001b";
const CLEAR_LINE = "\u0015";
// Esc で選択肢を閉じた後、TUI が入力欄を描き直すまでの待ち。実機で確かめた間隔。
const RESUME_KEY_SETTLE_MS = 2_500;

const OUTPUT_ACTIVE_GRACE_MS = 1500;
// Focus, resize, and keystrokes make the agent's TUI repaint. That repaint is
// real PTY output but a reaction to us poking the terminal, not the agent
// working. So output arriving this soon after we write/resize is ignored; only
// output the agent emits on its own (e.g. its spinner) counts as "working".
const OUTPUT_REACTION_WINDOW_MS = 1000;
const SESSION_MONITOR_INTERVAL_MS = 1000;
// On shutdown we SIGHUP every PTY and wait for node-pty to finish reaping the
// child before letting the process tear down; otherwise node-pty's native exit
// callback fires during environment cleanup and aborts. If a child ignores
// SIGHUP we escalate to SIGKILL after this grace period so quit can never hang.
const PTY_SHUTDOWN_GRACE_MS = 2000;
const WORKTREE_PROCESS_TERMINATION_GRACE_MS = 2000;
const WORKTREE_PROCESS_POLL_INTERVAL_MS = 100;
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, "g");

function createTerminalRuntimeId(kind: TerminalRuntimeKind): string {
  return `${kind}:runtime:${randomUUID()}`;
}

interface WorktreeSessionResumeTarget {
  provider: SessionProvider;
  agentSessionId: string;
  cwd: string;
  project: string;
  repoPath: string;
  worktreeId: string;
}

function resolveTaskWorktreePath(repoPath: string, branchName: string): string {
  return path.join(repoPath, ".yuru", "worktrees", branchName.replace(/\//g, "-"));
}

export interface YuruServiceEvents {
  fileTreeChanged(worktreeId: string, relativePath: string): void;
  ptyData(terminalRuntimeId: string, data: string): void;
  terminalRuntimeExited(terminalRuntimeId: string): void;
  sessionChanged(terminalRuntimeId: string, update: SessionUpdate): void;
  rateLimitStopsChanged(stops: RateLimitStop[]): void;
  bookmarksChanged(worktreeId: string): void;
  // 解除時刻になった後、サイドバーに出す利用状況も取り直す。
  refreshPlanUsage(): void;
  repoListChanged(): void;
  refreshWorktreeWatcher(): Promise<void>;
  addWorktreeWatcherRepo(repoPath: string): void;
}

export type YuruServiceTerminalEnv = Pick<TerminalEnvOptions, "apiSocketPath" | "yuruCliPath">;

// Agent session ごとに「前回 renderer へ push した値」を覚えておき、変わった時だけ push する。
interface SessionMonitorState {
  activityState: AgentActivityState;
  preview: string | null;
  checkingPreview: boolean;
}

interface BookmarkCaptureTarget {
  worktreePath: string;
  worktreeId: string;
}

// 会話ログからの bookmark 自動追加は実験中の機能。デフォルト OFF で、
// YURU_BOOKMARK_AUTO_CAPTURE=1 を付けて起動したときだけ watch を登録する。
function isBookmarkAutoCaptureEnabled(): boolean {
  return process.env.YURU_BOOKMARK_AUTO_CAPTURE === "1";
}

function ok<T>(data: T): Result<T> {
  return {
    ok: true,
    data,
  };
}

function fail<T>(error: AppError): Result<T> {
  return {
    ok: false,
    error,
  };
}

function isAppError(error: unknown): error is AppError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const maybeError = error as { code?: unknown; message?: unknown };
  return typeof maybeError.code === "string" && typeof maybeError.message === "string";
}

function appendStartupOutput(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  if (combined.length <= STARTUP_OUTPUT_LIMIT) {
    return combined;
  }
  return combined.slice(-STARTUP_OUTPUT_LIMIT);
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function summarizeStartupOutput(output: string): string | undefined {
  const cleaned = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.slice(-3).join(" ");
}

function startupExitDetail(output: string, exitCode: number, signal?: number): string | undefined {
  const summary = summarizeStartupOutput(output);
  if (summary) {
    return summary;
  }
  if (signal && signal > 0) {
    return `Process exited with signal ${signal}.`;
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return `Process exited with code ${exitCode}.`;
  }
  return "Process exited immediately.";
}

function startupFailureMessage(
  pending: PendingTerminal,
  exitCode: number,
  signal?: number,
): AppError {
  const detail = startupExitDetail(pending.startupOutput, exitCode, signal);

  if (exitCode === 127) {
    return {
      code: "command_not_found",
      message: `${pending.launchLabel}. Yuru could not find a command needed to launch ${pending.command}.`,
      detail,
    };
  }

  if (exitCode === 126) {
    return {
      code: "command_failed",
      message: `${pending.launchLabel}. Yuru found ${pending.command}, but could not execute it.`,
      detail,
    };
  }

  return {
    code: "command_failed",
    message: `${pending.launchLabel}. ${pending.command} exited before startup finished.`,
    detail,
  };
}

// Resolves once node-pty has reaped the child and emitted "exit". SIGHUP first,
// then SIGKILL if the child outlives the grace period, so shutdown can wait for
// node-pty's native cleanup without ever hanging on a SIGHUP-ignoring child.
function killPtyAndWait(proc: pty.IPty): Promise<void> {
  return new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, PTY_SHUTDOWN_GRACE_MS);
    const disposable = proc.onExit(() => {
      clearTimeout(killTimer);
      disposable.dispose();
      resolve();
    });
    proc.kill();
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ESRCH"
  );
}

export class YuruService {
  private readonly ptyProcesses = new Map<string, pty.IPty>();
  private readonly ptyScreens = new Map<string, TerminalScreen>();
  private readonly ptyAttachments = new Map<string, { ready: boolean; pendingChunks: string[] }>();
  private readonly terminalRuntimeLastOutputAt = new Map<string, number>();
  // rate limit で断られた所で止まっている runtime と、解除時に続きを実行する指定。
  private readonly rateLimitStops = new Map<string, RateLimitStop>();
  private rateLimitResetTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly terminalRuntimeLastInputAt = new Map<string, number>();
  private readonly sessionMonitorStates = new Map<string, SessionMonitorState>();
  private readonly sessionMessageWatchStops = new Map<string, () => void>();
  private sessionMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingProcesses = new Set<pty.IPty>();
  private readonly terminalRuntimeMap = new Map<string, TerminalRuntimeInfo>();
  private readonly activatingSessionKeys = new Set<string>();
  private readonly activeCodeSearches = new Map<string, AbortController>();
  private readonly fileTreeWatcher: FileTreeWatcher;

  constructor(
    private readonly events: YuruServiceEvents,
    private readonly terminalEnv: YuruServiceTerminalEnv,
  ) {
    this.fileTreeWatcher = new FileTreeWatcher((worktreeId, relativePath) => {
      this.events.fileTreeChanged(worktreeId, relativePath);
    });
  }

  async getRepos() {
    const previewsByKey = await loadStoredSessionPreviews();
    const agentActivityStates = this.loadAgentActivityStatesByTerminalRuntimeId();
    const metadata = loadMetadata();
    const primaryWorktreePathsBySessionKey = indexPrimaryWorktreePathsBySessionKey(
      metadata.taskWorktrees,
    );
    return loadRepoList(
      this.getTerminalRuntimeIdsBySessionKey(),
      undefined,
      previewsByKey,
      loadSuggestedWorktreeSessions,
      this.getUnresolvedTerminalRuntimesByLaunchWorktreePath(),
      getLastKnownGitHubPullRequest,
      agentActivityStates,
      indexTerminalRuntimeIdsByTaskWorktreePath(
        this.terminalRuntimeMap,
        primaryWorktreePathsBySessionKey,
      ),
      metadata,
    );
  }

  // attach 登録から serialize 開始までを同期的に行うことで、attach 前に届いた出力は
  // 必ず復元スナップショットに、attach 後に届いた出力は必ず pendingChunks に入る。
  async attachPty(terminalRuntimeId: string): Promise<string> {
    this.ptyAttachments.set(terminalRuntimeId, {
      ready: false,
      pendingChunks: [],
    });
    const screen = this.ptyScreens.get(terminalRuntimeId);
    if (!screen) {
      return "";
    }
    return screen.serialize();
  }

  readyPty(terminalRuntimeId: string): string | null {
    const attachment = this.ptyAttachments.get(terminalRuntimeId);
    if (!attachment) {
      return null;
    }

    attachment.ready = true;
    const pendingChunk = attachment.pendingChunks.join("");
    attachment.pendingChunks = [];
    return pendingChunk || null;
  }

  detachPty(terminalRuntimeId: string): void {
    this.ptyAttachments.delete(terminalRuntimeId);
  }

  getErrors(): AppErrorNotice[] {
    return listErrorNotices();
  }

  dismissError(id: string): boolean {
    return dismissErrorNotice(id);
  }

  clearErrors(): boolean {
    return clearErrorNotices();
  }

  async resumePrimarySession(
    worktreeId: string,
    agentSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    return this.resumePrimaryWorktreeSession(worktreeId, agentSessionKey);
  }

  // 並び替えは renderer が持っている一覧の全 repo を順に送る。metadata 側の検証はせず、
  // 送られた順をそのまま書く。
  reorderRepos(repoIds: string[]): void {
    saveRepoOrder(repoIds);
    this.events.repoListChanged();
  }

  // 並び替えは renderer が持っている一覧の全 task worktree を順に送る。書けなかった時は
  // 一覧が古かった時なので、error center には残さず renderer に取り直させる。
  async reorderTaskWorktrees(repoId: string, worktreePaths: string[]): Promise<Result<void>> {
    if (!(await saveTaskWorktreeOrder(repoId, worktreePaths))) {
      return fail({
        code: "unknown",
        message: "Worktrees changed while reordering. The new order was not saved.",
      });
    }
    this.events.repoListChanged();
    return ok(undefined);
  }

  // 並び替えは renderer が持っているホームの全 primary session を順に送る。書けなかった時は
  // 一覧が古かった時なので、error center には残さず renderer に取り直させる。
  async reorderPrimarySessions(
    worktreeId: string,
    agentSessionKeys: string[],
  ): Promise<Result<void>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree || !savePrimarySessionOrder(worktree.worktreePath, agentSessionKeys)) {
      return fail({
        code: "unknown",
        message: "Sessions changed while reordering. The new order was not saved.",
      });
    }
    this.events.repoListChanged();
    return ok(undefined);
  }

  async resumeSuggestedSession(
    worktreeId: string,
    agentSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    return this.resumeSuggestedWorktreeSession(worktreeId, agentSessionKey);
  }

  // primary session の strong link だけを外す。worktree・Git の変更・provider store の
  // session 履歴には触れない。active な terminal runtime を持つ間は外させない
  // (UI は inactive の時だけ detach を出すが、一覧が古い場合はここで拒否して error center に出す)。
  async detachPrimarySession(worktreeId: string, agentSessionKey: string): Promise<Result<void>> {
    const target = await this.findPrimarySessionResumeTarget(worktreeId, agentSessionKey);
    if (!target) {
      return this.failAndReport<void>({
        code: "unknown",
        message: "This primary session no longer exists.",
      });
    }

    const activeTerminalRuntimeId = this.getTerminalRuntimeIdsBySessionKey().get(agentSessionKey);
    if (activeTerminalRuntimeId && this.ptyProcesses.has(activeTerminalRuntimeId)) {
      return this.failAndReport<void>({
        code: "unknown",
        message: "This session is still running. Exit it in the terminal before detaching.",
      });
    }

    detachPrimarySessionByPath(target.project, {
      provider: target.provider,
      agentSessionId: target.agentSessionId,
    });
    return ok(undefined);
  }

  async createSessionForWorktree(
    worktreeId: string,
    provider: SessionProvider,
    initialPrompt?: string,
    model?: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    const agent = getAgent(provider);
    let pending: PendingSession | null = null;
    try {
      upsertTaskWorktree(worktree.repoId, worktree.worktreePath);
      pending = this.launchPendingSession(
        agent,
        await agent.createWorktreeLaunch(
          this.createContextForExistingWorktree(worktree, initialPrompt, model),
        ),
        "Failed to create worktree session",
        worktree.repoPath,
      );
      const terminalRuntimeId = await this.startSession(agent, pending, {
        worktreePath: worktree.worktreePath,
        worktreeId,
      });
      pending.startupSettled = true;
      return ok({ worktreeId, terminalRuntimeId });
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: agent.command });
      return pending?.startupFailureReported
        ? fail<WorktreeSessionSelection>(appError)
        : this.failAndReport<WorktreeSessionSelection>(appError);
    }
  }

  async createSessionForWorktreePath(
    worktreePath: string,
    provider: SessionProvider,
    initialPrompt?: string,
    model?: string,
  ): Promise<
    Result<{
      worktreePath: string;
      provider: SessionProvider;
      agentSessionId: string | null;
    }>
  > {
    let repo;
    try {
      repo = await findRepoByWorktreePath(worktreePath);
    } catch (error) {
      return this.failAndReport(toAppError(error, { command: "git" }));
    }
    if (!repo) {
      return this.failAndReport({
        code: "unknown",
        message: `Worktree "${worktreePath}" does not belong to a repository registered in Yuru.`,
      });
    }

    const resolvedWorktreePath = path.resolve(worktreePath);
    const result = await this.createSessionForWorktree(
      toWorktreeId(repo.id, resolvedWorktreePath),
      provider,
      initialPrompt,
      model,
    );
    if (!result.ok) {
      return result;
    }
    const agentSessionId =
      this.terminalRuntimeMap.get(result.data.terminalRuntimeId)?.agentSessionId ?? null;
    // API callers do not receive the renderer selection result used by the in-app
    // session start flow. Push a repo refresh so the new runtime appears on its
    // worktree card immediately, including while a lazy provider session ID is unresolved.
    this.events.repoListChanged();
    return ok({
      worktreePath: resolvedWorktreePath,
      provider,
      agentSessionId,
    });
  }

  async openWorktreeTerminal(worktreeId: string): Promise<Result<WorktreeSessionSelection>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    const activeTerminalRuntimeId = this.findStandaloneTerminalRuntimeId(worktree.worktreePath);
    if (activeTerminalRuntimeId) {
      return ok({ worktreeId, terminalRuntimeId: activeTerminalRuntimeId });
    }

    let pending: PendingTerminal | null = null;
    try {
      pending = this.launchPendingTerminal({
        cwd: worktree.worktreePath,
        env: createTerminalEnv(process.env, {
          ...this.terminalEnv,
          repoPath: worktree.repoPath,
          worktreePath: worktree.worktreePath,
        }),
        launchLabel: "Failed to start terminal",
        runtimeKind: "standalone",
        worktreePath: worktree.worktreePath,
      });
      this.registerStandaloneTerminalRuntime(pending);
      pending.startupSettled = true;
      return ok({ worktreeId, terminalRuntimeId: pending.terminalRuntimeId });
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: pending?.command });
      return pending?.startupFailureReported
        ? fail<WorktreeSessionSelection>(appError)
        : this.failAndReport<WorktreeSessionSelection>(appError);
    }
  }

  async killTerminalRuntime(terminalRuntimeId: string): Promise<void> {
    const proc = this.ptyProcesses.get(terminalRuntimeId);
    if (!proc) {
      return;
    }
    await killPtyAndWait(proc);
  }

  async createTaskWorktree(
    repoPath: string,
    branchName: string,
  ): Promise<Result<CreatedTaskWorktree>> {
    return this.createTaskWorktreeWithGit(repoPath, branchName, (worktreePath) =>
      createWorktree(repoPath, worktreePath, branchName),
    );
  }

  async createTaskWorktreeForRepoPath(
    repoPath: string,
    branchName: string,
  ): Promise<Result<{ worktreePath: string; branchName: string }>> {
    const result = await this.createTaskWorktree(repoPath, branchName);
    if (!result.ok) {
      return result;
    }
    // API callers cannot refresh the renderer after receiving the result. This
    // explicit push also covers a repo whose first task worktree was just
    // created, because its .git/worktrees watcher did not exist before creation.
    this.events.repoListChanged();
    return ok({
      worktreePath: resolveTaskWorktreePath(repoPath, branchName),
      branchName,
    });
  }

  // 第 2 の worktree 作成方法 (F42)。branch を HEAD から切る代わりに origin から取り込む。
  async createTaskWorktreeFromRemoteBranch(
    repoPath: string,
    branchName: string,
  ): Promise<Result<CreatedTaskWorktree>> {
    return this.createTaskWorktreeWithGit(repoPath, branchName, async (worktreePath) => {
      await fetchOriginBranch(repoPath, branchName);
      await createWorktreeFromOriginBranch(repoPath, worktreePath, branchName);
    });
  }

  // 両方の作成方法で共通の、名前解決・事前チェック・作成後の登録。branch の作り方だけが違う。
  private async createTaskWorktreeWithGit(
    repoPath: string,
    branchName: string,
    runGitCreate: (worktreePath: string) => Promise<void>,
  ): Promise<Result<CreatedTaskWorktree>> {
    const worktreeName = branchName.replace(/\//g, "-");
    const worktreePath = resolveTaskWorktreePath(repoPath, branchName);

    const repo = findRepoByPath(repoPath);
    if (!repo) {
      return this.failAndReport<CreatedTaskWorktree>({
        code: "unknown",
        message: `Repository "${repoPath}" is not registered in Yuru. Run \`yuru add <directory>\` first.`,
      });
    }

    if (fs.existsSync(worktreePath)) {
      return this.failAndReport<CreatedTaskWorktree>({
        code: "filesystem_failed",
        message: `Worktree "${worktreeName}" already exists`,
      });
    }
    if (await branchExists(repoPath, branchName)) {
      return this.failAndReport<CreatedTaskWorktree>({
        code: "git_failed",
        message: `Branch "${branchName}" already exists`,
      });
    }

    try {
      await runGitCreate(worktreePath);
    } catch (error) {
      return this.failAndReport<CreatedTaskWorktree>(toAppError(error, { command: "git" }));
    }
    upsertTaskWorktree(repo.id, worktreePath);
    this.events.addWorktreeWatcherRepo(repoPath);
    return ok({ worktreeId: toWorktreeId(repo.id, worktreePath) });
  }

  // 確認ダイアログを閉じる前の削除準備。通常削除の初回だけ dirty を先に確認し、
  // force が必要ならセッションを止める前に renderer へ返す。削除が承認された後は Yuru が
  // 起動したセッションを止め、それでも残ったプロセスに明示確認を取る。確認済みプロセスは
  // PID と command を照合してから SIGTERM を送り、全件の終了を確認して ready を返す。
  async prepareWorktreeRemoval(
    worktreeId: string,
    force: boolean,
    processesToStop?: WorktreeProcessRef[],
  ): Promise<Result<WorktreeRemovalPreparationOutcome>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeRemovalPreparationOutcome>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    try {
      // process_alive からの再実行では dirty を再検査しない。準備中や実削除中に状態が
      // 変わった場合は executeWorktreeRemoval の失敗として記録し、次の操作で再確認する。
      if (!force && !processesToStop && (await isWorktreeDirty(worktree.worktreePath))) {
        return ok({ status: "dirty" });
      }

      await this.stopTerminalRuntimesForWorktree(worktree.worktreePath);

      let liveProcesses = await listLiveProcessesInWorktree(
        worktree.worktreePath,
        worktree.repoPath,
      );
      if (liveProcesses.length > 0) {
        if (!processesToStop) {
          return ok({ status: "process_alive", processes: liveProcesses });
        }

        const approvedProcesses = new Map(
          processesToStop.map((processInfo) => [processInfo.pid, processInfo.command]),
        );
        const hasUnapprovedProcess = liveProcesses.some(
          (processInfo) => approvedProcesses.get(processInfo.pid) !== processInfo.command,
        );
        if (hasUnapprovedProcess) {
          return ok({ status: "process_alive", processes: liveProcesses });
        }

        for (const processInfo of liveProcesses) {
          try {
            process.kill(processInfo.pid, "SIGTERM");
          } catch (error) {
            if (!isNoSuchProcessError(error)) {
              throw error;
            }
          }
        }

        const deadline = Date.now() + WORKTREE_PROCESS_TERMINATION_GRACE_MS;
        while (
          Date.now() < deadline &&
          (await hasLiveProcessInWorktree(worktree.worktreePath, worktree.repoPath))
        ) {
          await wait(WORKTREE_PROCESS_POLL_INTERVAL_MS);
        }

        liveProcesses = await listLiveProcessesInWorktree(worktree.worktreePath, worktree.repoPath);
        if (liveProcesses.length > 0) {
          return ok({ status: "process_alive", processes: liveProcesses });
        }
      }

      return ok({ status: "ready" });
    } catch (error) {
      return this.failAndReport<WorktreeRemovalPreparationOutcome>(toAppError(error));
    }
  }

  // ready 後のバックグラウンド削除。ここから確認ダイアログへ状態を戻すことはない。
  // 準備後に新しいプロセスや dirty が発生した場合は warning、その他の失敗は error center に
  // 記録し、renderer は一覧を再取得して再試行可能な状態へ戻す。
  async executeWorktreeRemoval(worktreeId: string, force: boolean): Promise<Result<void>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<void>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    try {
      await this.stopTerminalRuntimesForWorktree(worktree.worktreePath);
      const liveProcesses = await listLiveProcessesInWorktree(
        worktree.worktreePath,
        worktree.repoPath,
      );
      if (liveProcesses.length > 0) {
        return this.failAndWarn<void>({
          code: "unknown",
          message: `Could not remove worktree "${path.basename(worktree.worktreePath)}".`,
          detail: `${liveProcesses.length} process${
            liveProcesses.length === 1 ? "" : "es"
          } started using it after confirmation. Try removing it again.`,
        });
      }
    } catch (error) {
      return this.failAndReport<void>(toAppError(error));
    }

    try {
      // git worktree のロックは .git 配下に残るファイルで、かけたプロセス (Claude Code など) が
      // 異常終了すると残留する。生きたプロセスがないことを再確認済みなので、解除してから消す。
      if (worktree.locked) {
        await unlockGitWorktree(worktree.repoPath, worktree.worktreePath);
      }
      if (force) {
        await removeGitWorktreeForce(worktree.repoPath, worktree.worktreePath);
      } else {
        await removeGitWorktree(worktree.repoPath, worktree.worktreePath);
      }
    } catch (error) {
      if (!force && (await isWorktreeDirty(worktree.worktreePath))) {
        return this.failAndWarn<void>({
          code: "git_failed",
          message: `Could not remove worktree "${path.basename(worktree.worktreePath)}".`,
          detail: "It has uncommitted changes. Try removing it again.",
        });
      }
      return this.failAndReport<void>(toAppError(error, { command: "git" }));
    }

    // worktree ディレクトリが消えた以上、そこに紐づく file 監視と進行中の code 検索はもう無効。
    // 消えたパスを指したまま残さないようここで止める。
    this.cancelActiveCodeSearch(worktreeId);
    this.fileTreeWatcher.clearWorktree(worktreeId);

    removeTaskWorktreeByPath(worktree.worktreePath);
    removeFileReviews(worktree.worktreePath);
    removeStoredBookmarks(worktree.worktreePath);
    return ok(undefined);
  }

  async openExternal(url: string): Promise<void> {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Unsupported external URL protocol.");
    }

    await shell.openExternal(parsedUrl.toString());
  }

  async getGitPathStates(worktreeId: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await loadGitPathStates(workingRoot));
    } catch (error) {
      // 3 秒ポーリングで呼ばれるため、失敗は警告として記録しつつ Changes は空表示にする。
      recordAppWarning(toAppError(error, { command: "git" }));
      return ok([]);
    }
  }

  async getReviewState(worktreeId: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      return ok(await loadReviewState(workingRoot));
    } catch (error) {
      return this.failAndReport(toAppError(error, { command: "git" }));
    }
  }

  async setFileReviewed(
    worktreeId: string,
    filePath: string,
    scope: GitDiffScope | undefined,
    reviewed: boolean,
  ) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return this.failAndReport<void>({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    try {
      return ok(await saveFileReviewed(workingRoot, filePath, scope, reviewed));
    } catch (error) {
      return this.failAndReport<void>(toAppError(error, { command: "git" }));
    }
  }

  async getBookmarks(worktreeId: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(loadBookmarks(workingRoot));
    } catch (error) {
      return this.failAndReport(toAppError(error));
    }
  }

  async removeBookmark(worktreeId: string, url: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return this.failAndReport<void>({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    try {
      removeStoredBookmark(workingRoot, url);
    } catch (error) {
      return this.failAndReport<void>(toAppError(error));
    }
    this.events.bookmarksChanged(worktreeId);
    return ok(undefined);
  }

  // ターミナルやメッセージ表示でクリックされた URL をブックマークに登録する。
  async addBookmark(worktreeId: string, url: string) {
    const parsedUrl = URL.canParse(url) ? new URL(url) : null;
    if (!parsedUrl || (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")) {
      return this.failAndReport<void>({
        code: "invalid_path",
        message: "Only http/https URLs can be bookmarked.",
        detail: url,
      });
    }
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return this.failAndReport<void>({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    let added: Bookmark[];
    try {
      added = addBookmarks(workingRoot, [url]);
    } catch (error) {
      return this.failAndReport<void>(toAppError(error));
    }
    if (added.length === 0) {
      return ok(undefined);
    }
    this.events.bookmarksChanged(worktreeId);
    this.resolveBookmarkTitles({ worktreePath: workingRoot, worktreeId }, added);
    return ok(undefined);
  }

  private resolveBookmarkTitles(target: BookmarkCaptureTarget, added: Bookmark[]): void {
    void Promise.all(
      added.map(async (bookmark) => {
        const title = await resolveUrlTitle(bookmark.url);
        if (!title) {
          return;
        }
        try {
          if (updateBookmarkTitle(target.worktreePath, bookmark.url, title)) {
            this.events.bookmarksChanged(target.worktreeId);
          }
        } catch (error) {
          recordAppWarning(toAppError(error));
        }
      }),
    );
  }

  // provider の保存ログに追加された user / assistant の会話本文から URL を記録する。
  // tool result やターミナルのコマンド出力は provider 側の message reader が除外する。
  // session monitor の tick から呼ばれるので、保存の失敗 (bookmarks.json の破損など) は
  // 警告に留めて preview 更新を巻き込まない。
  private captureSessionMessageUrls(
    target: BookmarkCaptureTarget,
    messages: readonly string[],
  ): void {
    const urls = messages.flatMap((message) => findHttpUrls(message).map((match) => match.url));
    if (urls.length === 0) {
      return;
    }
    let added: Bookmark[];
    try {
      added = addBookmarks(target.worktreePath, urls);
    } catch (error) {
      recordAppWarning(toAppError(error));
      return;
    }
    if (added.length === 0) {
      return;
    }
    this.events.bookmarksChanged(target.worktreeId);
    this.resolveBookmarkTitles(target, added);
  }

  private async watchSessionMessagesForRuntime(
    terminalRuntimeId: string,
    agent: Agent,
    agentSessionId: string,
    includeExistingMessages: boolean,
    target: BookmarkCaptureTarget,
  ): Promise<void> {
    if (!isBookmarkAutoCaptureEnabled()) {
      return;
    }
    const stop = await agent.watchSessionMessages(
      agentSessionId,
      includeExistingMessages,
      (messages) => this.captureSessionMessageUrls(target, messages),
    );
    const runtime = this.terminalRuntimeMap.get(terminalRuntimeId);
    if (runtime?.agentSessionId !== agentSessionId) {
      stop();
      return;
    }
    this.sessionMessageWatchStops.get(terminalRuntimeId)?.();
    this.sessionMessageWatchStops.set(terminalRuntimeId, stop);
  }

  async getGitDiffDocument(worktreeId: string, filePath: string, scope?: GitDiffScope) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      // worktree 外のファイル (ターミナルリンク由来の絶対パス) は git が絡まない。
      // 差分なしの単純表示にする (scope は来ない前提だが、来ても無視する)。
      if (path.isAbsolute(filePath)) {
        return ok(await getFileDocument(filePath));
      }
      return ok(await loadGitDiffDocument(workingRoot, filePath, scope));
    } catch (error) {
      // 外部ファイルの読み取り失敗 (EACCES 等) は git の失敗ではないのでラベルを分ける。
      // Result の失敗として返し、renderer の表示を Loading のままにしない。
      return this.failAndReport(
        toAppError(error, path.isAbsolute(filePath) ? undefined : { command: "git" }),
      );
    }
  }

  async getImageDiffDocument(worktreeId: string, filePath: string, scope?: GitDiffScope) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      if (path.isAbsolute(filePath)) {
        return ok(await getImageFileDocument(filePath));
      }
      return ok(await loadImageDiffDocument(workingRoot, filePath, scope));
    } catch (error) {
      return this.failAndReport(
        toAppError(error, path.isAbsolute(filePath) ? undefined : { command: "git" }),
      );
    }
  }

  async listFiles(worktreeId: string, relativePath?: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([]);
    }
    try {
      return ok(await listRepoFiles(workingRoot, relativePath ?? ""));
    } catch (error) {
      return this.failAndReport(toAppError(error));
    }
  }

  async listAllFiles(worktreeId: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok([] as string[]);
    }
    try {
      return ok(await listAllRepoFiles(workingRoot));
    } catch (error) {
      return this.failAndReport(toAppError(error, { command: "git" }));
    }
  }

  listRecentFiles(worktreeId: string) {
    const repo = findRepoByWorktreeId(worktreeId);
    if (!repo) {
      return ok([] as string[]);
    }
    try {
      return ok(loadRecentFiles(repo.repoPath));
    } catch (error) {
      return this.failAndReport(toAppError(error));
    }
  }

  recordRecentFile(worktreeId: string, filePath: string): void {
    // 履歴は repo 単位で、worktree をまたいで同じ相対パスを指す。worktree の外を指す
    // 絶対パス (ターミナルのリンクから開いた場合) は他の worktree で開き直せないので残さない。
    if (path.isAbsolute(filePath)) {
      return;
    }
    const repo = findRepoByWorktreeId(worktreeId);
    if (!repo) {
      return;
    }
    addRecentFile(repo.repoPath, filePath);
  }

  async readWorktreeFile(worktreeId: string, filePath: string): Promise<Result<string | null>> {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return fail({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    try {
      return ok(await readRepoWorktreeFile(workingRoot, filePath));
    } catch (error) {
      return this.failAndReport(toAppError(error));
    }
  }

  async writeFile(worktreeId: string, filePath: string, content: string): Promise<Result<void>> {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return fail({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    try {
      await writeRepoFile(workingRoot, filePath, content);
      return ok(undefined);
    } catch (error) {
      // 編集中に削除された等で対象が無いのは想定内の競合。error center に出さず静かに失敗。
      if (isFileNotFoundError(error)) {
        return fail({ code: "filesystem_failed", message: "File no longer exists." });
      }
      return this.failAndReport(toAppError(error));
    }
  }

  async resolveRepoFile(worktreeId: string, filePath: string): Promise<string | null> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return null;
    }
    return resolveRepoFilePath(worktree.worktreePath, filePath, worktree.repoPath);
  }

  async resolveHtmlPreviewEntry(
    worktreeId: string,
    filePath: string,
  ): Promise<Result<{ root: string; path: string }>> {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return fail({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }
    const entry = resolveHtmlPreviewEntryPath(workingRoot, filePath);
    if (!entry) {
      return fail({
        code: "invalid_path",
        message: "HTML preview file is no longer available.",
      });
    }
    return ok(entry);
  }

  async syncFileWatchTargets(worktreeId: string, relativePaths: string[]): Promise<void> {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      this.fileTreeWatcher.clearWorktree(worktreeId);
      return;
    }

    await this.fileTreeWatcher.syncWorktreeTargets(worktreeId, workingRoot, relativePaths);
  }

  async searchCode(worktreeId: string, query: string) {
    this.cancelActiveCodeSearch(worktreeId);

    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return fail({
        code: "invalid_path",
        message: "Selected worktree is no longer available.",
      });
    }

    const controller = new AbortController();
    this.activeCodeSearches.set(worktreeId, controller);
    try {
      return ok(
        await runCodeSearch(workingRoot, query, {
          signal: controller.signal,
          limit: CODE_SEARCH_RESULT_LIMIT,
        }),
      );
    } catch (error) {
      if (isCodeSearchCancelledError(error)) {
        return ok(createEmptyCodeSearchResult(query, CODE_SEARCH_RESULT_LIMIT));
      }
      return fail(toAppError(error, { command: "rg" }));
    } finally {
      if (this.activeCodeSearches.get(worktreeId) === controller) {
        this.activeCodeSearches.delete(worktreeId);
      }
    }
  }

  cancelCodeSearch(worktreeId: string): void {
    this.cancelActiveCodeSearch(worktreeId);
  }

  ptyWrite(terminalRuntimeId: string, data: string): void {
    const proc = this.ptyProcesses.get(terminalRuntimeId);
    if (proc) {
      proc.write(data);
      // xterm の onData はキー入力だけでなく、TUI からの問い合わせに対する端末応答も
      // 流す。後者まで入力扱いすると、その直後の agent 出力を再描画として除外してしまう。
      if (!isCursorPositionReport(data)) {
        this.markTerminalRuntimeInput(terminalRuntimeId);
      }
    }
  }

  // どの session が rate limit で止まっているかを取り直す。停止を一度見つけた後は、
  // 利用率が下がっても解除とは見なさず、記録したリセット時刻まで待つ。
  async refreshRateLimitStops(usages: readonly ProviderPlanUsage[]): Promise<void> {
    const now = Date.now();
    const reset = this.takeRateLimitStopsPastReset(now);
    const resetIds = new Set(reset.map((stop) => stop.terminalRuntimeId));
    const resetsAtByProvider = new Map<SessionProvider, number | null>();
    for (const usage of usages) {
      if (usage.state !== "ok") {
        continue;
      }
      const until = exhaustedUntil(usage);
      // 過ぎたリセット時刻と 100% の組み合わせは、provider 側の表示が遅れている状態。
      // 古い停止を作り直さず、未来のリセットか時刻不明の停止だけを新規検出に使う。
      if (until !== undefined && !isRateLimitResetDue(until, now)) {
        resetsAtByProvider.set(usage.provider, until);
      }
    }

    // agent の記録を読んでいる間にも、チェック操作や解除タイマーで現在の停止記録は
    // 変わりうる。読み始めた時の値を書き戻さず、確認結果だけを後で差分反映する。
    const noLongerStopped = new Set(this.rateLimitStops.keys());
    const newStops: RateLimitStop[] = [];
    await Promise.all(
      [...this.terminalRuntimeMap].map(async ([terminalRuntimeId, runtime]) => {
        if (runtime.provider === null || runtime.agentSessionId === null) {
          return;
        }
        const previous = this.rateLimitStops.get(terminalRuntimeId);
        if (
          resetIds.has(terminalRuntimeId) ||
          (previous === undefined && !resetsAtByProvider.has(runtime.provider)) ||
          !this.ptyProcesses.has(terminalRuntimeId)
        ) {
          return;
        }
        const agent = getAgent(runtime.provider);
        if (!(await agent.isStoppedByRateLimit?.(runtime.agentSessionId))) {
          return;
        }
        if (previous !== undefined) {
          // Map 上の現在値には触れず、チェック中に入った指定をそのまま残す。
          noLongerStopped.delete(terminalRuntimeId);
          return;
        }
        newStops.push({
          terminalRuntimeId,
          provider: runtime.provider,
          resetsAt: resetsAtByProvider.get(runtime.provider) ?? null,
          continueWhenReset: false,
        });
      }),
    );

    for (const terminalRuntimeId of noLongerStopped) {
      this.rateLimitStops.delete(terminalRuntimeId);
    }
    for (const stop of newStops) {
      // 別の refresh が先に追加していた場合も、その現在値を上書きしない。
      if (!this.rateLimitStops.has(stop.terminalRuntimeId)) {
        this.rateLimitStops.set(stop.terminalRuntimeId, stop);
      }
    }
    this.events.rateLimitStopsChanged([...this.rateLimitStops.values()]);
    this.scheduleRateLimitReset();
    await Promise.all(
      reset
        .filter((stop) => stop.continueWhenReset)
        .map((stop) => this.sendRateLimitResumeInput(stop)),
    );
  }

  setContinueWhenRateLimitResets(terminalRuntimeId: string, continueWhenReset: boolean): void {
    const stop = this.rateLimitStops.get(terminalRuntimeId);
    if (
      !stop ||
      (continueWhenReset && stop.resetsAt === null) ||
      stop.continueWhenReset === continueWhenReset
    ) {
      return;
    }
    this.rateLimitStops.set(terminalRuntimeId, { ...stop, continueWhenReset });
    this.events.rateLimitStopsChanged([...this.rateLimitStops.values()]);
    this.scheduleRateLimitReset();
  }

  // 利用状況の取得とは別に、続きを待っている session の最初の解除時刻へタイマーを張る。
  // provider からその時刻に利用率を取得できなくても、時刻だけで解除処理を進める。
  private scheduleRateLimitReset(): void {
    if (this.rateLimitResetTimer !== null) {
      clearTimeout(this.rateLimitResetTimer);
      this.rateLimitResetTimer = null;
    }
    const delay = nextResetDelayMs(
      [...this.rateLimitStops.values()]
        .filter((stop) => stop.continueWhenReset)
        .map((stop) => stop.resetsAt),
      Date.now(),
    );
    if (delay === null) {
      return;
    }
    this.rateLimitResetTimer = setTimeout(() => {
      this.rateLimitResetTimer = null;
      void this.handleRateLimitResetTime();
    }, delay);
  }

  private async handleRateLimitResetTime(): Promise<void> {
    const reset = this.takeRateLimitStopsPastReset(Date.now());
    if (reset.length === 0) {
      this.scheduleRateLimitReset();
      return;
    }
    this.events.rateLimitStopsChanged([...this.rateLimitStops.values()]);
    this.scheduleRateLimitReset();
    this.events.refreshPlanUsage();
    await Promise.all(
      reset
        .filter((stop) => stop.continueWhenReset)
        .map((stop) => this.sendRateLimitResumeInput(stop)),
    );
  }

  // リセット時刻を過ぎた停止は、送信の成否にかかわらずここで外す。同じ session へ
  // 何度も送らず、指定していなかった session の古い表示も残さないため。
  private takeRateLimitStopsPastReset(now: number): RateLimitStop[] {
    const reset = [...this.rateLimitStops.values()].filter((stop) =>
      isRateLimitResetDue(stop.resetsAt, now),
    );
    for (const stop of reset) {
      this.rateLimitStops.delete(stop.terminalRuntimeId);
    }
    return reset;
  }

  // 選択肢が出ている可能性があるので、まず Esc で閉じてから送る。Esc はどの agent でも
  // キャンセル側にしか倒れず、承認はしない。Esc は入力欄を消さないので、人が打ちかけて
  // いた文字に続きが繋がらないよう Ctrl+U で消してから入力する。
  private async sendRateLimitResumeInput(stop: RateLimitStop): Promise<void> {
    const terminalRuntimeId = stop.terminalRuntimeId;
    const proc = this.ptyProcesses.get(terminalRuntimeId);
    const agentSessionId = this.terminalRuntimeMap.get(terminalRuntimeId)?.agentSessionId;
    if (!proc || !agentSessionId) {
      return;
    }
    // 止まっていることが分かったのは最後に記録を読んだ時点なので、その後に人が自分で
    // 続きを始めていることがある。動いているターンに Esc を送ると中断させてしまうため、
    // 送る直前に読み直して、まだ止まったままの時だけ送る。
    if (!(await getAgent(stop.provider).isStoppedByRateLimit?.(agentSessionId))) {
      return;
    }
    // 送った直後に PTY が死ぬこともあるので、書き込みのたびに生死を見る。
    const writer = {
      write: (data: string) => {
        if (this.ptyProcesses.has(terminalRuntimeId)) {
          proc.write(data);
        }
      },
    };
    this.markTerminalRuntimeInput(terminalRuntimeId);
    writer.write(ESCAPE);
    await setTimeoutPromise(RESUME_KEY_SETTLE_MS);
    writer.write(CLEAR_LINE);
    await setTimeoutPromise(RESUME_KEY_SETTLE_MS);
    await deliverInitialInput(writer, RATE_LIMIT_RESUME_INPUT);
  }

  ptyResize(terminalRuntimeId: string, cols: number, rows: number): void {
    const proc = this.ptyProcesses.get(terminalRuntimeId);
    const screen = this.ptyScreens.get(terminalRuntimeId);
    if (proc && screen) {
      proc.resize(cols, rows);
      screen.resize(cols, rows);
      this.markTerminalRuntimeInput(terminalRuntimeId);
    }
  }

  async stop(): Promise<void> {
    this.fileTreeWatcher.stop();
    await this.killAllPty();
  }

  private failAndReport<T>(error: AppError): Result<T> {
    recordAppError(error);
    return fail(error);
  }

  private failAndWarn<T>(error: AppError): Result<T> {
    recordAppWarning(error);
    return fail(error);
  }

  private cancelActiveCodeSearch(worktreeId: string): void {
    const activeSearch = this.activeCodeSearches.get(worktreeId);
    if (!activeSearch) {
      return;
    }
    activeSearch.abort();
    this.activeCodeSearches.delete(worktreeId);
  }

  private getTerminalRuntimeIdsBySessionKey(): Map<string, string> {
    const idsByKey = new Map<string, string>();
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (info.provider !== null && info.agentSessionId !== null) {
        idsByKey.set(toSessionKey(info.provider, info.agentSessionId), terminalRuntimeId);
      }
    }
    return idsByKey;
  }

  // PullRequestMonitor がリポジトリごとのポーリング間隔を決めるのに使う。
  // launch target worktree は必ず repo 配下にあるため、その位置で repo への所属を判定できる。
  hasAliveTerminalRuntimeInRepo(repoPath: string): boolean {
    for (const info of this.terminalRuntimeMap.values()) {
      if (isPathWithin(repoPath, info.launchWorktreePath)) {
        return true;
      }
    }
    return false;
  }

  private getUnresolvedTerminalRuntimesByLaunchWorktreePath(): Map<
    string,
    { provider: SessionProvider; terminalRuntimeId: string }
  > {
    const terminalRuntimesByWorktreePath = new Map<
      string,
      { provider: SessionProvider; terminalRuntimeId: string }
    >();
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (!isUnresolvedProviderRuntime(info)) {
        continue;
      }
      terminalRuntimesByWorktreePath.set(path.resolve(info.launchWorktreePath), {
        provider: info.provider,
        terminalRuntimeId,
      });
    }
    return terminalRuntimesByWorktreePath;
  }

  private launchPendingSession(
    agent: Agent,
    request: LaunchRequest,
    launchLabel: string,
    repoPath: string,
  ): PendingSession {
    const pendingTerminal = this.launchPendingTerminal(
      {
        cwd: request.cwd,
        env: createTerminalEnv(process.env, {
          ...this.terminalEnv,
          provider: agent.definition.id,
          repoPath,
          worktreePath: request.worktreePath,
        }),
        launchLabel,
        runtimeKind: agent.definition.id,
        startupCommand: {
          command: agent.command,
          args: request.args,
        },
        worktreePath: request.worktreePath,
      },
      () => {
        void this.events.refreshWorktreeWatcher();
      },
    );

    return Object.assign(pendingTerminal, {
      provider: agent.definition.id,
      agentSessionId: null,
      existingAgentSessionIds: request.existingAgentSessionIds ?? new Set<string>(),
      initialInput: request.initialInput ?? null,
      initialPrompt: request.initialPrompt ?? null,
    });
  }

  private launchPendingTerminal(
    request: TerminalLaunchRequest,
    onExit?: (pending: PendingTerminal) => void,
  ): PendingTerminal {
    const startedAt = Date.now();
    const terminalRuntimeId = createTerminalRuntimeId(request.runtimeKind);
    const launchCommand = createInteractiveShellLaunchCommand(request.env, request.startupCommand);
    const initialCols = 80;
    const initialRows = 24;
    const proc = pty.spawn(launchCommand.command, launchCommand.args, {
      name: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
      cwd: request.cwd,
      env: request.env,
    });
    this.pendingProcesses.add(proc);
    const pending: PendingTerminal = {
      proc,
      command: request.startupCommand?.command ?? launchCommand.command,
      launchCwd: request.cwd,
      launchLabel: request.launchLabel,
      screen: new TerminalScreen(initialCols, initialRows),
      startupOutput: "",
      worktreePath: request.worktreePath,
      terminalRuntimeId,
      startedAt,
      exited: false,
      startupSettled: false,
      startupFailureReported: false,
    };

    setTimeout(() => {
      pending.startupSettled = true;
    }, 1500);

    proc.onData((data: string) => {
      pending.screen.write(data);
      if (!pending.startupSettled) {
        pending.startupOutput = appendStartupOutput(pending.startupOutput, data);
      }
      if (!this.ptyProcesses.has(pending.terminalRuntimeId)) {
        return;
      }
      if (
        !isCursorPositionQuery(data) &&
        !this.isTerminalRuntimeReacting(pending.terminalRuntimeId)
      ) {
        this.terminalRuntimeLastOutputAt.set(pending.terminalRuntimeId, Date.now());
      }
      const attachment = this.ptyAttachments.get(pending.terminalRuntimeId);
      if (!attachment) {
        return;
      }
      if (!attachment.ready) {
        attachment.pendingChunks.push(data);
        return;
      }
      this.events.ptyData(pending.terminalRuntimeId, data);
    });

    proc.onExit(({ exitCode, signal }) => {
      pending.exited = true;
      pending.exitCode = exitCode;
      pending.signal = signal;
      console.info("[Yuru] terminal process exited", {
        terminalRuntimeId: pending.terminalRuntimeId,
        command: pending.command,
        launchCwd: pending.launchCwd,
        worktreePath: pending.worktreePath,
        exitCode,
        signal,
        startupSettled: pending.startupSettled,
      });
      this.pendingProcesses.delete(proc);
      pending.screen.dispose();
      if (!pending.startupSettled && !pending.startupFailureReported) {
        pending.startupFailureReported = true;
        recordAppError(startupFailureMessage(pending, exitCode, signal));
      }
      if (!this.ptyProcesses.has(pending.terminalRuntimeId)) {
        return;
      }
      this.clearTerminalRuntimeState(pending.terminalRuntimeId);
      this.ptyProcesses.delete(pending.terminalRuntimeId);
      this.ptyScreens.delete(pending.terminalRuntimeId);
      this.ptyAttachments.delete(pending.terminalRuntimeId);
      this.terminalRuntimeMap.delete(pending.terminalRuntimeId);
      this.events.terminalRuntimeExited(pending.terminalRuntimeId);
      onExit?.(pending);
    });

    return pending;
  }

  private registerTerminalRuntime(pending: PendingSession, agentSessionId: string | null): void {
    pending.agentSessionId = agentSessionId;
    this.pendingProcesses.delete(pending.proc);
    this.ptyProcesses.set(pending.terminalRuntimeId, pending.proc);
    this.ptyScreens.set(pending.terminalRuntimeId, pending.screen);
    this.terminalRuntimeMap.set(pending.terminalRuntimeId, {
      provider: pending.provider,
      agentSessionId,
      launchWorktreePath: pending.worktreePath,
      startedAt: pending.startedAt,
    });
    this.ensureSessionMonitor();
  }

  private registerStandaloneTerminalRuntime(pending: PendingTerminal): void {
    this.pendingProcesses.delete(pending.proc);
    this.ptyProcesses.set(pending.terminalRuntimeId, pending.proc);
    this.ptyScreens.set(pending.terminalRuntimeId, pending.screen);
    this.terminalRuntimeMap.set(pending.terminalRuntimeId, {
      provider: null,
      agentSessionId: null,
      launchWorktreePath: pending.worktreePath,
      startedAt: pending.startedAt,
    });
  }

  // この task worktree に現在結びつく provider runtime / standalone terminal を止める。
  // kill すると pty の onExit が走り runtime の state も片付く。worktree 削除前に呼ぶことで、
  // Yuru 製プロセスを消してから生プロセスチェックにかけられる。
  private async stopTerminalRuntimesForWorktree(worktreePath: string): Promise<void> {
    const worktreePathKey = path.resolve(worktreePath);
    const primaryWorktreePathsBySessionKey =
      indexPrimaryWorktreePathsBySessionKey(loadTaskWorktrees());
    const procs: pty.IPty[] = [];
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (
        resolveTerminalRuntimeTaskWorktreePath(info, primaryWorktreePathsBySessionKey) !==
        worktreePathKey
      ) {
        continue;
      }
      const proc = this.ptyProcesses.get(terminalRuntimeId);
      if (proc) {
        procs.push(proc);
      }
    }
    await Promise.all(procs.map((proc) => killPtyAndWait(proc)));
  }

  private findStandaloneTerminalRuntimeId(worktreePath: string): string | null {
    const worktreePathKey = path.resolve(worktreePath);
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (info.provider || path.resolve(info.launchWorktreePath) !== worktreePathKey) {
        continue;
      }
      if (this.ptyProcesses.has(terminalRuntimeId)) {
        return terminalRuntimeId;
      }
    }
    return null;
  }

  private updateTerminalRuntimeAgentSessionId(
    terminalRuntimeId: string,
    agentSessionId: string,
  ): void {
    const runtime = this.terminalRuntimeMap.get(terminalRuntimeId);
    if (runtime && runtime.provider !== null) {
      this.terminalRuntimeMap.set(terminalRuntimeId, {
        ...runtime,
        agentSessionId,
      });
    }
  }

  private clearTerminalRuntimeState(terminalRuntimeId: string): void {
    this.terminalRuntimeLastOutputAt.delete(terminalRuntimeId);
    this.terminalRuntimeLastInputAt.delete(terminalRuntimeId);
    this.sessionMonitorStates.delete(terminalRuntimeId);
    this.sessionMessageWatchStops.get(terminalRuntimeId)?.();
    this.sessionMessageWatchStops.delete(terminalRuntimeId);
    if (this.rateLimitStops.delete(terminalRuntimeId)) {
      this.events.rateLimitStopsChanged([...this.rateLimitStops.values()]);
    }
  }

  private clearTerminalRuntimeStates(): void {
    this.terminalRuntimeLastOutputAt.clear();
    this.terminalRuntimeLastInputAt.clear();
    this.sessionMonitorStates.clear();
    for (const stop of this.sessionMessageWatchStops.values()) {
      stop();
    }
    this.sessionMessageWatchStops.clear();
    this.rateLimitStops.clear();
    this.events.rateLimitStopsChanged([]);
    this.scheduleRateLimitReset();
    this.stopSessionMonitor();
  }

  private async resolveLazySessionId(
    agent: Agent,
    pending: PendingSession,
    terminalRuntimeId: string,
    bookmarkTarget: BookmarkCaptureTarget,
  ): Promise<void> {
    try {
      const agentSessionId = await agent.waitForSessionId(pending);
      if (pending.exited) {
        return;
      }
      pending.agentSessionId = agentSessionId;
      pending.startupSettled = true;
      if (!this.terminalRuntimeMap.has(terminalRuntimeId)) {
        return;
      }
      // primary を先に attach し、runtime の ID 更新まで await を挟まない。一覧取得からは、
      // launch target 上の ID 未確定 runtime か、primary に結びついた既知 runtime の
      // どちらかとしてだけ観測される。
      attachPrimarySessionByPath(pending.worktreePath, {
        provider: pending.provider,
        agentSessionId,
        cwd: pending.launchCwd,
      });
      this.updateTerminalRuntimeAgentSessionId(terminalRuntimeId, agentSessionId);
      await this.watchSessionMessagesForRuntime(
        terminalRuntimeId,
        agent,
        agentSessionId,
        true,
        bookmarkTarget,
      );
      this.deliverInitialMessages(agent, pending);
      await this.events.refreshWorktreeWatcher();
      this.events.repoListChanged();
    } catch {
      // Codex can stay active before it persists a resumable session; ignore resolution failures here.
    }
  }

  private async killAllPty(): Promise<void> {
    const procs = [...this.ptyProcesses.values(), ...this.pendingProcesses.values()];
    this.ptyProcesses.clear();
    this.ptyAttachments.clear();
    this.pendingProcesses.clear();
    // screen の dispose は各 PTY の onExit で行われる。
    this.ptyScreens.clear();
    this.clearTerminalRuntimeStates();
    await Promise.all(procs.map((proc) => killPtyAndWait(proc)));
  }

  // Recent terminal output normally means the agent is working. A provider can
  // override that heuristic when its terminal title exposes an explicit
  // semantic state, such as Codex's animated permission prompt.
  private loadAgentActivityStatesByTerminalRuntimeId(): Map<string, AgentActivityState> {
    const states = new Map<string, AgentActivityState>();
    for (const [terminalRuntimeId, runtime] of this.terminalRuntimeMap) {
      if (!runtime.provider) {
        continue;
      }
      states.set(terminalRuntimeId, this.resolveTerminalRuntimeActivityState(terminalRuntimeId));
    }
    return states;
  }

  private resolveTerminalRuntimeActivityState(terminalRuntimeId: string): AgentActivityState {
    const runtime = this.terminalRuntimeMap.get(terminalRuntimeId);
    if (!runtime?.provider) {
      return "waiting";
    }
    const userActionRequiredDetected =
      getAgent(runtime.provider).detectUserActionRequired?.(
        this.ptyScreens.get(terminalRuntimeId)?.getTitle() ?? "",
      ) ?? false;
    if (userActionRequiredDetected) {
      return "waiting";
    }
    return this.isTerminalRuntimeOutputActive(terminalRuntimeId) ? "working" : "waiting";
  }

  private isTerminalRuntimeOutputActive(terminalRuntimeId: string): boolean {
    const lastOutputAt = this.terminalRuntimeLastOutputAt.get(terminalRuntimeId);
    return lastOutputAt !== undefined && Date.now() - lastOutputAt < OUTPUT_ACTIVE_GRACE_MS;
  }

  private ensureSessionMonitor(): void {
    if (this.sessionMonitorTimer === null) {
      this.sessionMonitorTimer = setInterval(() => {
        this.handleSessionMonitorTick();
      }, SESSION_MONITOR_INTERVAL_MS);
    }
  }

  private stopSessionMonitor(): void {
    if (this.sessionMonitorTimer !== null) {
      clearInterval(this.sessionMonitorTimer);
      this.sessionMonitorTimer = null;
    }
  }

  // 動作中セッションの活動状態とプレビューを確認する。provider の同じ増分読み取りに
  // message watcher も相乗りし、user / assistant message の URL を記録する。
  // renderer が取りに来るのは初期表示などの getRepos だけで、以降の状態更新は push で届く。
  private handleSessionMonitorTick(): void {
    let hasAgentRuntime = false;
    for (const [terminalRuntimeId, runtime] of this.terminalRuntimeMap) {
      if (!runtime.provider) {
        continue;
      }
      hasAgentRuntime = true;
      const state = this.getSessionMonitorState(terminalRuntimeId);
      const activityState = this.resolveTerminalRuntimeActivityState(terminalRuntimeId);
      const activityChanged = activityState !== state.activityState;
      if (activityChanged) {
        state.activityState = activityState;
        this.events.sessionChanged(terminalRuntimeId, { activityState });
      }
      // working 中はログが伸びるので毎 tick 確認する。working → waiting の遷移直後の
      // 1 回は、ターン終了時に書かれた最後のメッセージを取りこぼさないための確認。
      if (state.preview === null || activityState === "working" || activityChanged) {
        void this.checkSessionPreview(
          terminalRuntimeId,
          runtime.provider,
          runtime.agentSessionId ?? null,
          state,
        );
      }
    }
    if (!hasAgentRuntime) {
      this.stopSessionMonitor();
    }
  }

  private getSessionMonitorState(terminalRuntimeId: string): SessionMonitorState {
    const existing = this.sessionMonitorStates.get(terminalRuntimeId);
    if (existing) {
      return existing;
    }
    const state: SessionMonitorState = {
      activityState: "waiting",
      preview: null,
      checkingPreview: false,
    };
    this.sessionMonitorStates.set(terminalRuntimeId, state);
    return state;
  }

  private async checkSessionPreview(
    terminalRuntimeId: string,
    provider: SessionProvider,
    agentSessionId: string | null,
    state: SessionMonitorState,
  ): Promise<void> {
    if (!agentSessionId || state.checkingPreview) {
      return;
    }
    state.checkingPreview = true;
    try {
      const preview = (await loadStoredSessionPreview(provider, agentSessionId)) ?? "";
      if (preview === state.preview) {
        return;
      }
      state.preview = preview;
      this.events.sessionChanged(terminalRuntimeId, { preview });
    } finally {
      state.checkingPreview = false;
    }
  }

  private markTerminalRuntimeInput(terminalRuntimeId: string): void {
    this.terminalRuntimeLastInputAt.set(terminalRuntimeId, Date.now());
  }

  // True while output is likely a repaint reacting to our own write/resize
  // rather than the agent working on its own.
  private isTerminalRuntimeReacting(terminalRuntimeId: string): boolean {
    const lastInputAt = this.terminalRuntimeLastInputAt.get(terminalRuntimeId);
    return lastInputAt !== undefined && Date.now() - lastInputAt < OUTPUT_REACTION_WINDOW_MS;
  }

  private async findPrimarySessionResumeTarget(
    worktreeId: string,
    agentSessionKey: string,
  ): Promise<WorktreeSessionResumeTarget | null> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return null;
    }
    const taskWorktree = loadTaskWorktrees().find(
      (entry) =>
        entry.repoId === worktree.repoId &&
        path.resolve(entry.worktreePath) === path.resolve(worktree.worktreePath),
    );
    if (!taskWorktree) {
      return null;
    }

    const primarySession = taskWorktree.primarySessions.find(
      (session) => toSessionKey(session.provider, session.agentSessionId) === agentSessionKey,
    );
    if (!primarySession) {
      return null;
    }

    return {
      provider: primarySession.provider,
      agentSessionId: primarySession.agentSessionId,
      // Entries written before cwd was recorded predate promote support and were
      // all created at the repo root, so fall back to it.
      cwd: primarySession.cwd ?? worktree.repoPath,
      project: taskWorktree.worktreePath,
      repoPath: worktree.repoPath,
      worktreeId,
    };
  }

  private async findSuggestedSession(
    worktreePath: string,
    agentSessionKey: string,
  ): Promise<SuggestedWorktreeSession | null> {
    const suggestedSessions = await loadSuggestedWorktreeSessions([worktreePath]);
    return (
      (suggestedSessions.get(worktreePath) ?? []).find(
        (session) => toSessionKey(session.provider, session.agentSessionId) === agentSessionKey,
      ) ?? null
    );
  }

  private async findGitWorktree(worktreeId: string): Promise<{
    repoId: string;
    repoPath: string;
    worktreePath: string;
    branch: string | null;
    headSha: string | null;
    locked: boolean;
  } | null> {
    for (const repo of loadRepos()) {
      if (!(await isSupportedGitRepo(repo.repoPath))) {
        continue;
      }
      if (toWorktreeId(repo.id, repo.repoPath) === worktreeId) {
        const [branch, headSha] = await Promise.all([
          getCurrentBranch(repo.repoPath),
          getHeadSha(repo.repoPath),
        ]);
        return {
          repoId: repo.id,
          repoPath: repo.repoPath,
          worktreePath: repo.repoPath,
          branch,
          headSha,
          // main worktree は git の仕様上ロックできない
          locked: false,
        };
      }
      const worktrees = await listWorktrees(repo.repoPath);
      const worktree = worktrees.find((entry) => toWorktreeId(repo.id, entry.path) === worktreeId);
      if (worktree) {
        return {
          repoId: repo.id,
          repoPath: repo.repoPath,
          worktreePath: worktree.path,
          branch: worktree.branch,
          headSha: worktree.headSha,
          locked: worktree.locked,
        };
      }
    }
    return null;
  }

  private createContextForExistingWorktree(
    worktree: {
      repoPath: string;
      worktreePath: string;
      branch: string | null;
      headSha: string | null;
    },
    initialPrompt?: string,
    model?: string,
  ): WorktreeContext {
    const fallbackBranchName = worktree.headSha
      ? `detached @ ${worktree.headSha.slice(0, 7)}`
      : "no commits";
    return {
      repoPath: worktree.repoPath,
      worktreePath: worktree.worktreePath,
      worktreeName: path.basename(worktree.worktreePath),
      branchName: worktree.branch ?? fallbackBranchName,
      initialPrompt,
      model,
    };
  }

  private async getWorkingRootForWorktree(worktreeId: string): Promise<string | null> {
    const worktree = await this.findGitWorktree(worktreeId);
    return worktree?.worktreePath ?? null;
  }

  private promotePrimarySession(
    worktree: { repoId: string; worktreePath: string },
    session: SuggestedWorktreeSession,
  ): void {
    upsertTaskWorktree(worktree.repoId, worktree.worktreePath);
    attachPrimarySessionByPath(worktree.worktreePath, {
      provider: session.provider,
      agentSessionId: session.agentSessionId,
      cwd: session.cwd,
    });
  }

  private async activateWorktreeSession(
    target: WorktreeSessionResumeTarget,
    options: { detachMissingPrimary: boolean },
  ): Promise<Result<string>> {
    const agentSessionKey = toSessionKey(target.provider, target.agentSessionId);
    if (this.activatingSessionKeys.has(agentSessionKey)) {
      return fail({
        code: "command_failed",
        message: "This session is already starting.",
      });
    }

    this.activatingSessionKeys.add(agentSessionKey);
    const agent = getAgent(target.provider);
    let pending: PendingSession | null = null;
    let stopWatchingMessages: (() => void) | null = null;
    try {
      if (!(await agent.hasStoredSession(target.agentSessionId))) {
        if (options.detachMissingPrimary) {
          detachPrimarySessionByPath(target.project, {
            provider: target.provider,
            agentSessionId: target.agentSessionId,
          });
          this.events.repoListChanged();
        }
        return this.failAndReport<string>({
          code: "command_failed",
          message: "This session no longer exists.",
          detail: `${target.provider} session ${target.agentSessionId} was not found in saved conversations.`,
        });
      }

      stopWatchingMessages = isBookmarkAutoCaptureEnabled()
        ? await agent.watchSessionMessages(target.agentSessionId, false, (messages) =>
            this.captureSessionMessageUrls(
              { worktreePath: target.project, worktreeId: target.worktreeId },
              messages,
            ),
          )
        : null;

      pending = this.launchPendingSession(
        agent,
        await agent.createResumeLaunch(target),
        "Failed to resume session",
        target.repoPath,
      );
      this.registerTerminalRuntime(pending, target.agentSessionId);
      if (stopWatchingMessages) {
        this.sessionMessageWatchStops.set(pending.terminalRuntimeId, stopWatchingMessages);
        stopWatchingMessages = null;
      }
      return ok(pending.terminalRuntimeId);
    } catch (error) {
      stopWatchingMessages?.();
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = isAppError(error) ? error : toAppError(error, { command: agent.command });
      return pending?.startupFailureReported
        ? fail<string>(appError)
        : this.failAndReport<string>(appError);
    } finally {
      this.activatingSessionKeys.delete(agentSessionKey);
    }
  }

  private async resumePrimaryWorktreeSession(
    worktreeId: string,
    agentSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    const target = await this.findPrimarySessionResumeTarget(worktreeId, agentSessionKey);
    if (!target) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This primary session no longer exists.",
      });
    }

    const activeTerminalRuntimeId = this.getTerminalRuntimeIdsBySessionKey().get(agentSessionKey);
    if (activeTerminalRuntimeId && this.ptyProcesses.has(activeTerminalRuntimeId)) {
      return ok({ worktreeId, terminalRuntimeId: activeTerminalRuntimeId });
    }

    const result = await this.activateWorktreeSession(target, { detachMissingPrimary: true });
    if (result.ok) {
      return ok({ worktreeId, terminalRuntimeId: result.data });
    }
    return result;
  }

  private async resumeSuggestedWorktreeSession(
    worktreeId: string,
    agentSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    const suggestedSession = await this.findSuggestedSession(
      worktree.worktreePath,
      agentSessionKey,
    );
    if (!suggestedSession) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This suggested session no longer exists.",
      });
    }

    this.promotePrimarySession(worktree, suggestedSession);
    return this.resumePrimaryWorktreeSession(worktreeId, agentSessionKey);
  }

  private deliverInitialMessages(agent: Agent, pending: PendingSession): void {
    void (async () => {
      if (pending.initialInput !== null) {
        await this.deliverInitialMessage(agent, pending, pending.initialInput, "context");
      }
      if (pending.initialPrompt !== null) {
        await this.deliverInitialMessage(agent, pending, pending.initialPrompt, "prompt");
      }
    })();
  }

  private async deliverInitialMessage(
    agent: Agent,
    pending: PendingSession,
    initialInput: string,
    kind: "context" | "prompt",
  ): Promise<void> {
    if (pending.exited) {
      return;
    }
    const agentSessionId = pending.agentSessionId;
    const hasRecordedInitialInput = agent.hasRecordedInitialInput;
    const verify =
      hasRecordedInitialInput && agentSessionId
        ? () => hasRecordedInitialInput(agentSessionId, initialInput)
        : undefined;
    // node-pty throws when writing to an exited process; guard each write.
    const writer = {
      write: (data: string) => {
        if (!pending.exited) {
          pending.proc.write(data);
        }
      },
    };
    this.markTerminalRuntimeInput(pending.terminalRuntimeId);
    try {
      const verified = await deliverInitialInput(writer, initialInput, { verify });
      if (verified) {
        return;
      }
      console.warn("[Yuru] initial input was not recorded by the provider", {
        terminalRuntimeId: pending.terminalRuntimeId,
        provider: pending.provider,
        agentSessionId,
      });
      recordAppWarning({
        code: "unknown",
        message:
          kind === "context"
            ? `The worktree instructions may not have been delivered to the ${agent.definition.label} session.`
            : `The initial prompt may not have been delivered to the ${agent.definition.label} session.`,
        detail:
          kind === "context"
            ? "The session started in the repository root without its task worktree context. " +
              "Confirm where it is working before relying on it, or restart the session."
            : "The session started without the requested first task. Confirm its conversation before relying on it, or send the prompt again.",
      });
    } catch (error) {
      console.warn("[Yuru] failed to deliver initial input", {
        terminalRuntimeId: pending.terminalRuntimeId,
        provider: pending.provider,
        error,
      });
    }
  }

  private async startSession(
    agent: Agent,
    pending: PendingSession,
    bookmarkTarget: BookmarkCaptureTarget,
  ): Promise<string> {
    const terminalRuntimeId = pending.terminalRuntimeId;

    if (agent.resolvesSessionIdLazily) {
      this.registerTerminalRuntime(pending, null);
      void this.resolveLazySessionId(agent, pending, terminalRuntimeId, bookmarkTarget);
      return terminalRuntimeId;
    }

    const agentSessionId = await agent.waitForSessionId(pending);
    // runtime を既知 session として公開する前に primary を attach する。
    attachPrimarySessionByPath(pending.worktreePath, {
      provider: pending.provider,
      agentSessionId,
      cwd: pending.launchCwd,
    });
    this.registerTerminalRuntime(pending, agentSessionId);
    await this.watchSessionMessagesForRuntime(
      terminalRuntimeId,
      agent,
      agentSessionId,
      true,
      bookmarkTarget,
    );
    this.deliverInitialMessages(agent, pending);
    return terminalRuntimeId;
  }
}
