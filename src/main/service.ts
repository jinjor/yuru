import { shell } from "electron";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import * as pty from "node-pty";
import {
  attachPrimarySessionByPath,
  detachPrimarySessionByPath,
  findRepoByPath,
  loadRepos,
  loadTaskWorktrees,
  removeTaskWorktreeByPath,
  upsertTaskWorktree,
} from "./metadata.js";
import { loadRepoList } from "./repo-list.js";
import {
  loadStoredSessionActivity,
  loadStoredSessionPreviews,
  loadSuggestedWorktreeSessions,
} from "./sessions.js";
import { toWorktreeId } from "./worktree-identity.js";
import {
  branchExists,
  getCurrentBranch,
  getGitDiffDocument as loadGitDiffDocument,
  getGitPathStates as loadGitPathStates,
  getHeadSha,
  isSupportedGitRepo,
  isWorktreeDirty,
  listWorktrees,
  removeWorktree as removeGitWorktree,
  removeWorktreeForce as removeGitWorktreeForce,
} from "./git.js";
import { hasLiveProcessInWorktree } from "./worktree-process-check.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import {
  listAllFiles as listAllRepoFiles,
  listFiles as listRepoFiles,
  readWorktreeFile as readRepoWorktreeFile,
  resolveRepoFile as resolveRepoFilePath,
  writeFile as writeRepoFile,
} from "./files.js";
import { getSessionProvider, listSessionProviderDefinitions } from "./agent-registry.js";
import {
  CODE_SEARCH_RESULT_LIMIT,
  createEmptyCodeSearchResult,
  isCodeSearchCancelledError,
  searchCode as runCodeSearch,
} from "./code-search.js";
import {
  type LaunchRequest,
  type PendingSession,
  type SessionProviderAdapter,
  type WorktreeContext,
} from "./agent.js";
import type {
  PendingTerminal,
  TerminalLaunchRequest,
  TerminalRuntimeKind,
  TerminalRuntimeInfo,
} from "./terminal-runtime.js";
import { FileTreeWatcher } from "./file-tree-watcher.js";
import {
  type AppError,
  type AppErrorNotice,
  type GitDiffScope,
  type Result,
  type TerminalRuntimeActivityState,
  type WorktreeRemovalOutcome,
  type WorktreeSessionSelection,
} from "../shared/ipc.js";
import {
  type AgentActivityState,
  type SessionProvider,
  type SuggestedWorktreeSession,
  toSessionKey,
} from "../shared/session.js";
import { isFileNotFoundError, toAppError } from "./errors.js";
import {
  clearErrorNotices,
  dismissErrorNotice,
  listErrorNotices,
  recordAppError,
} from "./error-center.js";
import { createTerminalEnv } from "./terminal-env.js";
import { buildShellStartupCommand, createInteractiveShellLaunchCommand } from "./shell-launch.js";

const STARTUP_OUTPUT_LIMIT = 4000;
const TERMINAL_SCROLLBACK_LIMIT = 200000;
const OUTPUT_ACTIVE_GRACE_MS = 1500;
// On shutdown we SIGHUP every PTY and wait for node-pty to finish reaping the
// child before letting the process tear down; otherwise node-pty's native exit
// callback fires during environment cleanup and aborts. If a child ignores
// SIGHUP we escalate to SIGKILL after this grace period so quit can never hang.
const PTY_SHUTDOWN_GRACE_MS = 2000;
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, "g");

interface StartedSession {
  terminalRuntimeId: string;
  providerSessionId: string | null;
}

function createTerminalRuntimeId(kind: TerminalRuntimeKind): string {
  return `${kind}:runtime:${randomUUID()}`;
}

interface WorktreeSessionResumeTarget {
  provider: SessionProvider;
  providerSessionId: string;
  cwd: string;
  project: string;
}

export interface YuruServiceEvents {
  fileTreeChanged(worktreeId: string, relativePath: string): void;
  ptyData(terminalRuntimeId: string, data: string): void;
  terminalRuntimeExited(terminalRuntimeId: string): void;
  repoListChanged(): void;
  errorAdded(notice: AppErrorNotice): void;
  refreshWorktreeWatcher(): Promise<void>;
  addWorktreeWatcherRepo(repoPath: string): void;
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

function logAppError(error: AppError): void {
  if (error.detail) {
    console.error(`[Yuru] ${error.message}`, error.detail);
    return;
  }
  console.error(`[Yuru] ${error.message}`);
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

function appendTerminalOutput(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  if (combined.length <= TERMINAL_SCROLLBACK_LIMIT) {
    return combined;
  }
  return combined.slice(-TERMINAL_SCROLLBACK_LIMIT);
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

export class YuruService {
  private readonly ptyProcesses = new Map<string, pty.IPty>();
  private readonly ptyScrollback = new Map<string, string>();
  private readonly ptyAttachments = new Map<string, { ready: boolean; pendingChunks: string[] }>();
  private readonly terminalRuntimeLastOutputAt = new Map<string, number>();
  private readonly pendingProcesses = new Set<pty.IPty>();
  private readonly terminalRuntimeMap = new Map<string, TerminalRuntimeInfo>();
  private readonly activeCodeSearches = new Map<string, AbortController>();
  private readonly fileTreeWatcher: FileTreeWatcher;

  constructor(private readonly events: YuruServiceEvents) {
    this.fileTreeWatcher = new FileTreeWatcher((worktreeId, relativePath) => {
      this.events.fileTreeChanged(worktreeId, relativePath);
    });
  }

  async getRepos() {
    const [previewsByKey, agentActivityStates] = await Promise.all([
      loadStoredSessionPreviews(),
      this.loadAgentActivityStatesByTerminalRuntimeId(),
    ]);
    return loadRepoList(
      this.getTerminalRuntimeIdsBySessionKey(),
      undefined,
      previewsByKey,
      loadSuggestedWorktreeSessions,
      this.getTerminalRuntimesByWorktreePath(),
      getGitHubPullRequestForBranch,
      agentActivityStates,
    );
  }

  async getTerminalRuntimeActivityStates(
    terminalRuntimeIds: string[],
  ): Promise<TerminalRuntimeActivityState[]> {
    const statesByTerminalRuntimeId = await this.loadAgentActivityStatesByTerminalRuntimeId(
      new Set(terminalRuntimeIds),
    );
    return terminalRuntimeIds.flatMap((terminalRuntimeId) => {
      const activityState = statesByTerminalRuntimeId.get(terminalRuntimeId);
      return activityState ? [{ terminalRuntimeId, activityState }] : [];
    });
  }

  getSessionProviders() {
    return listSessionProviderDefinitions();
  }

  attachPty(terminalRuntimeId: string): string {
    this.ptyAttachments.set(terminalRuntimeId, {
      ready: false,
      pendingChunks: [],
    });
    return this.ptyScrollback.get(terminalRuntimeId) ?? "";
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
    providerSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    return this.resumePrimaryWorktreeSession(worktreeId, providerSessionKey);
  }

  async resumeSuggestedSession(
    worktreeId: string,
    providerSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    return this.resumeSuggestedWorktreeSession(worktreeId, providerSessionKey);
  }

  async createSessionForWorktree(
    worktreeId: string,
    provider: SessionProvider,
  ): Promise<Result<WorktreeSessionSelection>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    const providerAdapter = getSessionProvider(provider);
    let pending: PendingSession | null = null;
    try {
      upsertTaskWorktree(worktree.repoId, worktree.worktreePath);
      pending = this.launchPendingSession(
        providerAdapter,
        await providerAdapter.createWorktreeLaunch(this.createContextForExistingWorktree(worktree)),
        "Failed to create worktree session",
      );
      const { terminalRuntimeId, providerSessionId } = await this.startSession(
        providerAdapter,
        pending,
      );
      pending.startupSettled = true;
      if (providerSessionId) {
        attachPrimarySessionByPath(worktree.worktreePath, {
          provider,
          providerSessionId,
          cwd: pending.launchCwd,
        });
      }
      return ok({ worktreeId, terminalRuntimeId });
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = toAppError(error, { command: providerAdapter.command });
      return pending?.startupFailureReported
        ? fail<WorktreeSessionSelection>(appError)
        : this.failAndReport<WorktreeSessionSelection>(appError);
    }
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
        env: createTerminalEnv(process.env),
        launchLabel: "Failed to start terminal",
        runtimeKind: "standalone",
        worktreePath: worktree.worktreePath,
      });
      this.registerStandaloneTerminalRuntime(pending, worktree.repoPath);
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

  async createWorktreeSession(
    provider: SessionProvider,
    repoPath: string,
    branchName: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    const providerAdapter = getSessionProvider(provider);
    const worktreeName = branchName.replace(/\//g, "-");
    const worktreePath = providerAdapter.resolveWorktreePath(repoPath, worktreeName);
    const worktreeContext: WorktreeContext = {
      repoPath,
      worktreePath,
      worktreeName,
      branchName,
    };

    if (fs.existsSync(worktreePath)) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "filesystem_failed",
        message: `Worktree "${worktreeName}" already exists`,
      });
    }
    if (await branchExists(repoPath, branchName)) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "git_failed",
        message: `Branch "${branchName}" already exists`,
      });
    }

    const repo = findRepoByPath(repoPath);
    if (!repo) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: `Repository "${repoPath}" is not registered in Yuru. Run \`yuru add\` first.`,
      });
    }

    let pending: PendingSession | null = null;
    try {
      await providerAdapter.prepareWorktree(worktreeContext);
      upsertTaskWorktree(repo.id, worktreePath);

      pending = this.launchPendingSession(
        providerAdapter,
        await providerAdapter.createWorktreeLaunch(worktreeContext),
        "Failed to create worktree session",
      );
      const { terminalRuntimeId, providerSessionId } = await this.startSession(
        providerAdapter,
        pending,
      );
      pending.startupSettled = true;
      if (providerSessionId) {
        attachPrimarySessionByPath(worktreePath, {
          provider,
          providerSessionId,
        });
      }
      await providerAdapter.finalizeWorktree(worktreeContext);
      this.events.addWorktreeWatcherRepo(repoPath);
      return ok({
        worktreeId: toWorktreeId(repo.id, worktreePath),
        terminalRuntimeId,
      });
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      if (fs.existsSync(worktreePath)) {
        await removeGitWorktree(repoPath, worktreePath).catch(() => undefined);
      }
      removeTaskWorktreeByPath(worktreePath);
      const command = providerAdapter.command === "codex" ? "git" : providerAdapter.command;
      const appError = toAppError(error, { command });
      return pending?.startupFailureReported
        ? fail<WorktreeSessionSelection>(appError)
        : this.failAndReport<WorktreeSessionSelection>(appError);
    }
  }

  // 削除フローは renderer 側が確認ダイアログを出し分け、実行直前のチェックと git 削除をここで行う。
  // 生プロセスがいれば削除せず process_alive を、通常削除が dirty で拒否されたら dirty を返し、
  // どちらも確認ダイアログの差し替えに使う (→ docs/backlog-details/F41-worktree-removal.md)。
  async removeWorktree(
    worktreeId: string,
    force: boolean,
  ): Promise<Result<WorktreeRemovalOutcome>> {
    const worktree = await this.findGitWorktree(worktreeId);
    if (!worktree) {
      return this.failAndReport<WorktreeRemovalOutcome>({
        code: "unknown",
        message: "This worktree no longer exists.",
      });
    }

    if (await hasLiveProcessInWorktree(worktree.worktreePath, worktree.repoPath)) {
      return ok({ status: "process_alive" });
    }

    try {
      if (force) {
        await removeGitWorktreeForce(worktree.repoPath, worktree.worktreePath);
      } else {
        await removeGitWorktree(worktree.repoPath, worktree.worktreePath);
      }
    } catch (error) {
      if (!force && (await isWorktreeDirty(worktree.worktreePath))) {
        return ok({ status: "dirty" });
      }
      return this.failAndReport<WorktreeRemovalOutcome>(toAppError(error, { command: "git" }));
    }

    // worktree ディレクトリが消えた以上、そこに紐づく file 監視と進行中の code 検索はもう無効。
    // 消えたパスを指したまま残さないようここで止める。
    this.cancelActiveCodeSearch(worktreeId);
    this.fileTreeWatcher.clearWorktree(worktreeId);

    removeTaskWorktreeByPath(worktree.worktreePath);
    return ok({ status: "removed" });
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
    } catch {
      return ok([]);
    }
  }

  async getGitDiffDocument(worktreeId: string, filePath: string, scope?: GitDiffScope) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      return ok(await loadGitDiffDocument(workingRoot, filePath, scope));
    } catch (error) {
      return this.failAndReport(toAppError(error, { command: "git" }));
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
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return null;
    }
    return resolveRepoFilePath(workingRoot, filePath);
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
    }
  }

  ptyResize(terminalRuntimeId: string, cols: number, rows: number): void {
    const proc = this.ptyProcesses.get(terminalRuntimeId);
    if (proc) {
      proc.resize(cols, rows);
    }
  }

  async stop(): Promise<void> {
    this.fileTreeWatcher.stop();
    await this.killAllPty();
  }

  private reportError(error: AppError): AppError {
    logAppError(error);
    this.events.errorAdded(recordAppError(error));
    return error;
  }

  private failAndReport<T>(error: AppError): Result<T> {
    return fail(this.reportError(error));
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
      if (info.provider && info.providerSessionId) {
        idsByKey.set(toSessionKey(info.provider, info.providerSessionId), terminalRuntimeId);
      }
    }
    return idsByKey;
  }

  private getTerminalRuntimesByWorktreePath(): Map<
    string,
    { provider: SessionProvider; terminalRuntimeId: string }
  > {
    const terminalRuntimesByWorktreePath = new Map<
      string,
      { provider: SessionProvider; terminalRuntimeId: string }
    >();
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (!info.provider) {
        continue;
      }
      terminalRuntimesByWorktreePath.set(path.resolve(info.worktreePath), {
        provider: info.provider,
        terminalRuntimeId,
      });
    }
    return terminalRuntimesByWorktreePath;
  }

  private launchPendingSession(
    providerAdapter: SessionProviderAdapter,
    request: LaunchRequest,
    launchLabel: string,
  ): PendingSession {
    const pendingTerminal = this.launchPendingTerminal(
      {
        cwd: request.cwd,
        env: createTerminalEnv(process.env, providerAdapter.definition.id),
        launchLabel,
        runtimeKind: providerAdapter.definition.id,
        startupCommand: {
          command: providerAdapter.command,
          args: request.args,
        },
        worktreePath: request.worktreePath,
      },
      () => {
        void this.events.refreshWorktreeWatcher();
      },
    );

    return Object.assign(pendingTerminal, {
      provider: providerAdapter.definition.id,
      providerSessionId: null,
      existingProviderSessionIds: request.existingProviderSessionIds ?? new Set<string>(),
    });
  }

  private launchPendingTerminal(
    request: TerminalLaunchRequest,
    onExit?: (pending: PendingTerminal) => void,
  ): PendingTerminal {
    const startedAt = Date.now();
    const terminalRuntimeId = createTerminalRuntimeId(request.runtimeKind);
    const launchCommand = createInteractiveShellLaunchCommand(request.env);
    const proc = pty.spawn(launchCommand.command, launchCommand.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      env: request.env,
    });
    this.pendingProcesses.add(proc);
    const pending: PendingTerminal = {
      proc,
      command: request.startupCommand?.command ?? launchCommand.command,
      launchCwd: request.cwd,
      launchLabel: request.launchLabel,
      outputBuffer: "",
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
      pending.outputBuffer = appendTerminalOutput(pending.outputBuffer, data);
      if (!pending.startupSettled) {
        pending.startupOutput = appendStartupOutput(pending.startupOutput, data);
      }
      if (!this.ptyProcesses.has(pending.terminalRuntimeId)) {
        return;
      }
      this.terminalRuntimeLastOutputAt.set(pending.terminalRuntimeId, Date.now());
      this.ptyScrollback.set(
        pending.terminalRuntimeId,
        appendTerminalOutput(this.ptyScrollback.get(pending.terminalRuntimeId) ?? "", data),
      );
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
      if (!pending.startupSettled && !pending.startupFailureReported) {
        pending.startupFailureReported = true;
        this.reportError(startupFailureMessage(pending, exitCode, signal));
      }
      if (!this.ptyProcesses.has(pending.terminalRuntimeId)) {
        return;
      }
      this.clearTerminalRuntimeState(pending.terminalRuntimeId);
      this.ptyProcesses.delete(pending.terminalRuntimeId);
      this.ptyAttachments.delete(pending.terminalRuntimeId);
      this.terminalRuntimeMap.delete(pending.terminalRuntimeId);
      this.events.terminalRuntimeExited(pending.terminalRuntimeId);
      onExit?.(pending);
    });

    if (request.startupCommand) {
      proc.write(
        `${buildShellStartupCommand(request.startupCommand.command, request.startupCommand.args)}\r`,
      );
    }

    return pending;
  }

  private registerTerminalRuntime(pending: PendingSession, providerSessionId: string | null): void {
    pending.providerSessionId = providerSessionId;
    this.pendingProcesses.delete(pending.proc);
    this.ptyProcesses.set(pending.terminalRuntimeId, pending.proc);
    this.ptyScrollback.set(pending.terminalRuntimeId, pending.outputBuffer);
    this.terminalRuntimeMap.set(pending.terminalRuntimeId, {
      provider: pending.provider,
      providerSessionId,
      repoPath: pending.launchCwd,
      worktreePath: pending.worktreePath,
      startedAt: pending.startedAt,
    });
  }

  private registerStandaloneTerminalRuntime(pending: PendingTerminal, repoPath: string): void {
    this.pendingProcesses.delete(pending.proc);
    this.ptyProcesses.set(pending.terminalRuntimeId, pending.proc);
    this.ptyScrollback.set(pending.terminalRuntimeId, pending.outputBuffer);
    this.terminalRuntimeMap.set(pending.terminalRuntimeId, {
      repoPath,
      worktreePath: pending.worktreePath,
      startedAt: pending.startedAt,
    });
  }

  private findStandaloneTerminalRuntimeId(worktreePath: string): string | null {
    const worktreePathKey = path.resolve(worktreePath);
    for (const [terminalRuntimeId, info] of this.terminalRuntimeMap) {
      if (info.provider || path.resolve(info.worktreePath) !== worktreePathKey) {
        continue;
      }
      if (this.ptyProcesses.has(terminalRuntimeId)) {
        return terminalRuntimeId;
      }
    }
    return null;
  }

  private updateTerminalRuntimeProviderSessionId(
    terminalRuntimeId: string,
    providerSessionId: string,
  ): void {
    const runtime = this.terminalRuntimeMap.get(terminalRuntimeId);
    if (runtime) {
      this.terminalRuntimeMap.set(terminalRuntimeId, {
        ...runtime,
        providerSessionId,
      });
    }
  }

  private clearTerminalRuntimeState(terminalRuntimeId: string): void {
    this.terminalRuntimeLastOutputAt.delete(terminalRuntimeId);
  }

  private clearTerminalRuntimeStates(): void {
    this.terminalRuntimeLastOutputAt.clear();
  }

  private async resolveLazySessionId(
    providerAdapter: SessionProviderAdapter,
    pending: PendingSession,
    terminalRuntimeId: string,
  ): Promise<void> {
    try {
      const providerSessionId = await providerAdapter.waitForSessionId(pending);
      if (pending.exited) {
        return;
      }
      pending.providerSessionId = providerSessionId;
      pending.startupSettled = true;
      this.updateTerminalRuntimeProviderSessionId(terminalRuntimeId, providerSessionId);
      if (!this.terminalRuntimeMap.has(terminalRuntimeId)) {
        return;
      }
      attachPrimarySessionByPath(pending.worktreePath, {
        provider: pending.provider,
        providerSessionId,
        cwd: pending.launchCwd,
      });
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
    this.ptyScrollback.clear();
    this.clearTerminalRuntimeStates();
    await Promise.all(procs.map((proc) => killPtyAndWait(proc)));
  }

  private async loadAgentActivityStatesByTerminalRuntimeId(
    terminalRuntimeIds?: ReadonlySet<string>,
  ): Promise<Map<string, AgentActivityState>> {
    const entries = await Promise.all(
      Array.from(this.terminalRuntimeMap.entries()).map(async ([terminalRuntimeId, runtime]) => {
        if (terminalRuntimeIds && !terminalRuntimeIds.has(terminalRuntimeId)) {
          return null;
        }
        if (!runtime.provider) {
          return null;
        }
        if (!runtime.providerSessionId) {
          return [terminalRuntimeId, "waiting"] as const;
        }
        const activityState = await loadStoredSessionActivity(
          runtime.provider,
          runtime.providerSessionId,
          {
            outputActive: this.isTerminalRuntimeOutputActive(terminalRuntimeId),
          },
        );
        return activityState ? ([terminalRuntimeId, activityState] as const) : null;
      }),
    );
    return new Map(
      entries.filter((entry): entry is [string, AgentActivityState] => entry !== null),
    );
  }

  private isTerminalRuntimeOutputActive(terminalRuntimeId: string): boolean {
    const lastOutputAt = this.terminalRuntimeLastOutputAt.get(terminalRuntimeId);
    return lastOutputAt !== undefined && Date.now() - lastOutputAt < OUTPUT_ACTIVE_GRACE_MS;
  }

  private async findPrimarySessionResumeTarget(
    worktreeId: string,
    providerSessionKey: string,
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
    if (!taskWorktree?.primarySession) {
      return null;
    }

    const primarySessionKey = toSessionKey(
      taskWorktree.primarySession.provider,
      taskWorktree.primarySession.providerSessionId,
    );
    if (primarySessionKey !== providerSessionKey) {
      return null;
    }

    return {
      provider: taskWorktree.primarySession.provider,
      providerSessionId: taskWorktree.primarySession.providerSessionId,
      // Entries written before cwd was recorded predate promote support and were
      // all created at the repo root, so fall back to it.
      cwd: taskWorktree.primarySession.cwd ?? worktree.repoPath,
      project: taskWorktree.worktreePath,
    };
  }

  private async findSuggestedSession(
    worktreePath: string,
    providerSessionKey: string,
  ): Promise<SuggestedWorktreeSession | null> {
    const suggestedSessions = await loadSuggestedWorktreeSessions([worktreePath]);
    return (
      (suggestedSessions.get(worktreePath) ?? []).find(
        (session) =>
          toSessionKey(session.provider, session.providerSessionId) === providerSessionKey,
      ) ?? null
    );
  }

  private async findGitWorktree(worktreeId: string): Promise<{
    repoId: string;
    repoPath: string;
    worktreePath: string;
    branch: string | null;
    headSha: string | null;
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
        };
      }
    }
    return null;
  }

  private createContextForExistingWorktree(worktree: {
    repoPath: string;
    worktreePath: string;
    branch: string | null;
    headSha: string | null;
  }): WorktreeContext {
    const fallbackBranchName = worktree.headSha
      ? `detached @ ${worktree.headSha.slice(0, 7)}`
      : "no commits";
    return {
      repoPath: worktree.repoPath,
      worktreePath: worktree.worktreePath,
      worktreeName: path.basename(worktree.worktreePath),
      branchName: worktree.branch ?? fallbackBranchName,
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
      providerSessionId: session.providerSessionId,
      cwd: session.cwd,
    });
  }

  private async activateWorktreeSession(
    target: WorktreeSessionResumeTarget,
    options: { detachMissingPrimary: boolean },
  ): Promise<Result<string>> {
    const providerAdapter = getSessionProvider(target.provider);
    let pending: PendingSession | null = null;
    try {
      if (!(await providerAdapter.hasStoredSession(target.providerSessionId))) {
        if (options.detachMissingPrimary) {
          detachPrimarySessionByPath(target.project, {
            provider: target.provider,
            providerSessionId: target.providerSessionId,
          });
          this.events.repoListChanged();
        }
        return this.failAndReport<string>({
          code: "command_failed",
          message: "This session no longer exists.",
          detail: `${target.provider} session ${target.providerSessionId} was not found in saved conversations.`,
        });
      }

      pending = this.launchPendingSession(
        providerAdapter,
        await providerAdapter.createResumeLaunch(target),
        "Failed to resume session",
      );
      this.registerTerminalRuntime(pending, target.providerSessionId);
      return ok(pending.terminalRuntimeId);
    } catch (error) {
      if (pending && !pending.exited) {
        pending.proc.kill();
      }
      const appError = isAppError(error)
        ? error
        : toAppError(error, { command: providerAdapter.command });
      return pending?.startupFailureReported
        ? fail<string>(appError)
        : this.failAndReport<string>(appError);
    }
  }

  private async resumePrimaryWorktreeSession(
    worktreeId: string,
    providerSessionKey: string,
  ): Promise<Result<WorktreeSessionSelection>> {
    const target = await this.findPrimarySessionResumeTarget(worktreeId, providerSessionKey);
    if (!target) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This primary session no longer exists.",
      });
    }

    const activeTerminalRuntimeId =
      this.getTerminalRuntimeIdsBySessionKey().get(providerSessionKey);
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
    providerSessionKey: string,
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
      providerSessionKey,
    );
    if (!suggestedSession) {
      return this.failAndReport<WorktreeSessionSelection>({
        code: "unknown",
        message: "This suggested session no longer exists.",
      });
    }

    this.promotePrimarySession(worktree, suggestedSession);
    return this.resumePrimaryWorktreeSession(worktreeId, providerSessionKey);
  }

  private async startSession(
    providerAdapter: SessionProviderAdapter,
    pending: PendingSession,
  ): Promise<StartedSession> {
    const terminalRuntimeId = pending.terminalRuntimeId;

    if (providerAdapter.resolvesSessionIdLazily) {
      this.registerTerminalRuntime(pending, null);
      void this.resolveLazySessionId(providerAdapter, pending, terminalRuntimeId);
      return {
        terminalRuntimeId,
        providerSessionId: null,
      };
    }

    const providerSessionId = await providerAdapter.waitForSessionId(pending);
    this.registerTerminalRuntime(pending, providerSessionId);
    return {
      terminalRuntimeId,
      providerSessionId,
    };
  }
}
