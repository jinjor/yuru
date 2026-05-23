import { shell } from "electron";
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
import { toWorktreeId } from "./worktree-identity.js";
import { loadStoredSessionPreviews, loadSuggestedWorktreeSessions } from "./sessions.js";
import {
  branchExists,
  getCurrentBranch,
  getGitDiffDocument as loadGitDiffDocument,
  getGitPathStates as loadGitPathStates,
  getRepoRootForProject,
  listWorktrees,
  removeWorktree as removeGitWorktree,
} from "./git.js";
import { getGitHubPullRequestForBranch } from "./github.js";
import {
  listAllFiles as listAllRepoFiles,
  listFiles as listRepoFiles,
  resolveRepoFile as resolveRepoFilePath,
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
  type RuntimeSessionInfo,
  type SessionProviderAdapter,
  type WorktreeContext,
} from "./agent.js";
import { FileTreeWatcher } from "./file-tree-watcher.js";
import {
  type AppError,
  type AppErrorNotice,
  type BranchContext,
  type Result,
  type WorktreeSessionSelection,
} from "../shared/ipc.js";
import {
  type SessionProvider,
  type SuggestedWorktreeSession,
  toRuntimeSessionKey,
  toSessionKey,
} from "../shared/session.js";
import { toAppError } from "./errors.js";
import {
  clearErrorNotices,
  dismissErrorNotice,
  listErrorNotices,
  recordAppError,
} from "./error-center.js";
import { createTerminalEnv } from "./terminal-env.js";
import { createShellLaunchCommand } from "./shell-launch.js";

const STARTUP_OUTPUT_LIMIT = 4000;
const TERMINAL_SCROLLBACK_LIMIT = 200000;
const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*[A-Za-z]`, "g");

interface StartedSession {
  runtimeSessionId: string;
  providerSessionId: string | null;
}

interface WorktreeSessionResumeTarget {
  provider: SessionProvider;
  providerSessionId: string;
  repoPath: string;
  project: string;
}

export interface YuruServiceEvents {
  fileTreeChanged(runtimeSessionId: string, relativePath: string): void;
  ptyData(runtimeSessionId: string, data: string): void;
  sessionsStateChanged(): void;
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
  pending: PendingSession,
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

export class YuruService {
  private readonly ptyProcesses = new Map<string, pty.IPty>();
  private readonly ptyScrollback = new Map<string, string>();
  private readonly ptyAttachments = new Map<string, { ready: boolean; pendingChunks: string[] }>();
  private readonly pendingProcesses = new Set<pty.IPty>();
  private readonly sessionRuntimeMap = new Map<string, RuntimeSessionInfo>();
  private readonly activeCodeSearches = new Map<string, AbortController>();
  private readonly fileTreeWatcher: FileTreeWatcher;

  constructor(private readonly events: YuruServiceEvents) {
    this.fileTreeWatcher = new FileTreeWatcher((runtimeSessionId, relativePath) => {
      this.events.fileTreeChanged(runtimeSessionId, relativePath);
    });
  }

  async getRepos() {
    const previewsByKey = await loadStoredSessionPreviews();
    return loadRepoList(
      this.getActiveRuntimeSessionIdsByKey(),
      undefined,
      previewsByKey,
      loadSuggestedWorktreeSessions,
      this.getActiveRuntimeSessionsByWorktreePath(),
      getGitHubPullRequestForBranch,
    );
  }

  getSessionProviders() {
    return listSessionProviderDefinitions();
  }

  attachPty(runtimeSessionId: string): string {
    this.ptyAttachments.set(runtimeSessionId, {
      ready: false,
      pendingChunks: [],
    });
    return this.ptyScrollback.get(runtimeSessionId) ?? "";
  }

  readyPty(runtimeSessionId: string): string | null {
    const attachment = this.ptyAttachments.get(runtimeSessionId);
    if (!attachment) {
      return null;
    }

    attachment.ready = true;
    const pendingChunk = attachment.pendingChunks.join("");
    attachment.pendingChunks = [];
    return pendingChunk || null;
  }

  detachPty(runtimeSessionId: string): void {
    this.ptyAttachments.delete(runtimeSessionId);
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
      const { runtimeSessionId, providerSessionId } = await this.startSession(
        provider,
        providerAdapter,
        pending,
      );
      pending.startupSettled = true;
      if (providerSessionId) {
        attachPrimarySessionByPath(worktree.worktreePath, {
          provider,
          providerSessionId,
        });
      }
      return ok({ worktreeId, runtimeSessionId });
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
      const { runtimeSessionId, providerSessionId } = await this.startSession(
        provider,
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
        runtimeSessionId,
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

  async removeWorktree(repoPath: string, worktreePath: string): Promise<Result<boolean>> {
    if (this.hasActivePrimarySessionForWorktree(worktreePath)) {
      return this.failAndReport<boolean>({
        code: "unknown",
        message: "Stop the session before removing this worktree.",
      });
    }
    try {
      await removeGitWorktree(repoPath, worktreePath);
      removeTaskWorktreeByPath(worktreePath);
      return ok(true);
    } catch (error) {
      return this.failAndReport<boolean>(toAppError(error, { command: "git" }));
    }
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

  async getGitBranchContext(worktreeId: string): Promise<Result<BranchContext>> {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok({ branch: null, github: null } satisfies BranchContext);
    }

    try {
      const branch = await getCurrentBranch(workingRoot);
      if (!branch) {
        return ok({ branch: null, github: null } satisfies BranchContext);
      }

      const repoPath = (await getRepoRootForProject(workingRoot)) ?? workingRoot;
      const github = await getGitHubPullRequestForBranch(repoPath, branch);
      return ok({ branch, github } satisfies BranchContext);
    } catch (error) {
      return this.failAndReport(toAppError(error, { command: "git" }));
    }
  }

  async getGitDiffDocument(worktreeId: string, filePath: string) {
    const workingRoot = await this.getWorkingRootForWorktree(worktreeId);
    if (!workingRoot) {
      return ok(null);
    }
    try {
      return ok(await loadGitDiffDocument(workingRoot, filePath));
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
      this.fileTreeWatcher.clearSession(worktreeId);
      return;
    }

    await this.fileTreeWatcher.syncSessionTargets(worktreeId, workingRoot, relativePaths);
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

  ptyWrite(runtimeSessionId: string, data: string): void {
    const proc = this.ptyProcesses.get(runtimeSessionId);
    if (proc) {
      proc.write(data);
    }
  }

  ptyResize(runtimeSessionId: string, cols: number, rows: number): void {
    const proc = this.ptyProcesses.get(runtimeSessionId);
    if (proc) {
      proc.resize(cols, rows);
    }
  }

  stop(): void {
    this.fileTreeWatcher.stop();
    this.killAllPty();
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

  private getActiveRuntimeSessionIdsByKey(): Map<string, string> {
    const idsByKey = new Map<string, string>();
    for (const [runtimeSessionId, info] of this.sessionRuntimeMap) {
      if (info.providerSessionId) {
        idsByKey.set(toSessionKey(info.provider, info.providerSessionId), runtimeSessionId);
      }
    }
    return idsByKey;
  }

  private getActiveRuntimeSessionsByWorktreePath(): Map<
    string,
    { provider: SessionProvider; runtimeSessionId: string }
  > {
    const sessionsByWorktreePath = new Map<
      string,
      { provider: SessionProvider; runtimeSessionId: string }
    >();
    for (const [runtimeSessionId, info] of this.sessionRuntimeMap) {
      sessionsByWorktreePath.set(path.resolve(info.worktreePath), {
        provider: info.provider,
        runtimeSessionId,
      });
    }
    return sessionsByWorktreePath;
  }

  private hasActivePrimarySessionForWorktree(worktreePath: string): boolean {
    const worktreePathKey = path.resolve(worktreePath);
    const taskWorktree = loadTaskWorktrees().find(
      (entry) => path.resolve(entry.worktreePath) === worktreePathKey,
    );
    const primarySession = taskWorktree?.primarySession;
    if (!primarySession) {
      return false;
    }
    return this.getActiveRuntimeSessionIdsByKey().has(
      toSessionKey(primarySession.provider, primarySession.providerSessionId),
    );
  }

  private launchPendingSession(
    providerAdapter: SessionProviderAdapter,
    request: LaunchRequest,
    launchLabel: string,
  ): PendingSession {
    const existingProviderSessionIds = request.existingProviderSessionIds ?? new Set<string>();
    const launchCommand = createShellLaunchCommand(
      providerAdapter.command,
      request.args,
      process.env,
    );
    const proc = pty.spawn(launchCommand.command, launchCommand.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      env: createTerminalEnv(process.env, providerAdapter.definition.id),
    });
    this.pendingProcesses.add(proc);
    const pending: PendingSession = {
      proc,
      provider: providerAdapter.definition.id,
      command: providerAdapter.command,
      launchCwd: request.cwd,
      launchLabel,
      outputBuffer: "",
      startupOutput: "",
      worktreePath: request.worktreePath,
      providerSessionId: null,
      runtimeSessionId: null,
      startedAt: Date.now(),
      existingProviderSessionIds,
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
      if (!pending.runtimeSessionId) {
        return;
      }
      this.ptyScrollback.set(
        pending.runtimeSessionId,
        appendTerminalOutput(this.ptyScrollback.get(pending.runtimeSessionId) ?? "", data),
      );
      const attachment = this.ptyAttachments.get(pending.runtimeSessionId);
      if (!attachment) {
        return;
      }
      if (!attachment.ready) {
        attachment.pendingChunks.push(data);
        return;
      }
      this.events.ptyData(pending.runtimeSessionId, data);
    });

    proc.onExit(({ exitCode, signal }) => {
      pending.exited = true;
      pending.exitCode = exitCode;
      pending.signal = signal;
      console.info("[Yuru] session process exited", {
        runtimeSessionId: pending.runtimeSessionId,
        provider: pending.provider,
        providerSessionId: pending.providerSessionId,
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
      if (!pending.runtimeSessionId) {
        return;
      }
      this.ptyProcesses.delete(pending.runtimeSessionId);
      this.ptyAttachments.delete(pending.runtimeSessionId);
      this.fileTreeWatcher.clearSession(pending.runtimeSessionId);
      this.sessionRuntimeMap.delete(pending.runtimeSessionId);
      void this.events.refreshWorktreeWatcher();
      this.events.sessionsStateChanged();
    });

    return pending;
  }

  private registerRuntimeSession(
    runtimeSessionId: string,
    pending: PendingSession,
    providerSessionId: string | null,
  ): void {
    pending.providerSessionId = providerSessionId;
    pending.runtimeSessionId = runtimeSessionId;
    this.pendingProcesses.delete(pending.proc);
    this.ptyProcesses.set(runtimeSessionId, pending.proc);
    this.ptyScrollback.set(runtimeSessionId, pending.outputBuffer);
    this.sessionRuntimeMap.set(runtimeSessionId, {
      provider: pending.provider,
      providerSessionId,
      worktreePath: pending.worktreePath,
      startedAt: pending.startedAt,
    });
  }

  private createRuntimeSessionId(provider: SessionProvider, pending: PendingSession): string {
    return toRuntimeSessionKey(provider, pending.startedAt);
  }

  private updateRuntimeSessionProviderSessionId(
    runtimeSessionId: string,
    providerSessionId: string,
  ): void {
    const runtime = this.sessionRuntimeMap.get(runtimeSessionId);
    if (runtime) {
      this.sessionRuntimeMap.set(runtimeSessionId, {
        ...runtime,
        providerSessionId,
      });
    }
  }

  private async resolveLazySessionId(
    providerAdapter: SessionProviderAdapter,
    pending: PendingSession,
    runtimeSessionId: string,
  ): Promise<void> {
    try {
      const providerSessionId = await providerAdapter.waitForSessionId(pending);
      if (pending.exited) {
        return;
      }
      pending.providerSessionId = providerSessionId;
      pending.startupSettled = true;
      this.updateRuntimeSessionProviderSessionId(runtimeSessionId, providerSessionId);
      if (!this.sessionRuntimeMap.has(runtimeSessionId)) {
        return;
      }
      attachPrimarySessionByPath(pending.worktreePath, {
        provider: pending.provider,
        providerSessionId,
      });
      await this.events.refreshWorktreeWatcher();
      this.events.sessionsStateChanged();
    } catch {
      // Codex can stay active before it persists a resumable session; ignore resolution failures here.
    }
  }

  private killAllPty(): void {
    for (const proc of this.ptyProcesses.values()) {
      proc.kill();
    }
    for (const proc of this.pendingProcesses.values()) {
      proc.kill();
    }
    this.ptyProcesses.clear();
    this.ptyAttachments.clear();
    this.pendingProcesses.clear();
    this.ptyScrollback.clear();
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
      repoPath: worktree.repoPath,
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
    headSha: string;
  } | null> {
    for (const repo of loadRepos()) {
      const worktrees = await listWorktrees(repo.repoPath).catch(() => []);
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
    headSha: string;
  }): WorktreeContext {
    return {
      repoPath: worktree.repoPath,
      worktreePath: worktree.worktreePath,
      worktreeName: path.basename(worktree.worktreePath),
      branchName: worktree.branch ?? `detached @ ${worktree.headSha.slice(0, 7)}`,
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
          this.events.sessionsStateChanged();
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
      const runtimeSessionId = this.createRuntimeSessionId(target.provider, pending);
      this.registerRuntimeSession(runtimeSessionId, pending, target.providerSessionId);
      return ok(runtimeSessionId);
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

    const activeRuntimeSessionId = this.getActiveRuntimeSessionIdsByKey().get(providerSessionKey);
    if (activeRuntimeSessionId && this.ptyProcesses.has(activeRuntimeSessionId)) {
      return ok({ worktreeId, runtimeSessionId: activeRuntimeSessionId });
    }

    const result = await this.activateWorktreeSession(target, { detachMissingPrimary: true });
    if (result.ok) {
      return ok({ worktreeId, runtimeSessionId: result.data });
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
    provider: SessionProvider,
    providerAdapter: SessionProviderAdapter,
    pending: PendingSession,
  ): Promise<StartedSession> {
    const runtimeSessionId = this.createRuntimeSessionId(provider, pending);

    if (providerAdapter.resolvesSessionIdLazily) {
      this.registerRuntimeSession(runtimeSessionId, pending, null);
      void this.resolveLazySessionId(providerAdapter, pending, runtimeSessionId);
      return {
        runtimeSessionId,
        providerSessionId: null,
      };
    }

    const providerSessionId = await providerAdapter.waitForSessionId(pending);
    this.registerRuntimeSession(runtimeSessionId, pending, providerSessionId);
    return {
      runtimeSessionId,
      providerSessionId,
    };
  }
}
