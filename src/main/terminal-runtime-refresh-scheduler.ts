const DEFAULT_OUTPUT_SETTLED_DELAY_MS = 1200;
const DEFAULT_REFRESH_BACKOFF_DELAYS_MS = [
  15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
] as const;

type TerminalRuntimeRefreshTimer = ReturnType<typeof setTimeout>;
type RefreshDueHandler = (terminalRuntimeId: string) => void | Promise<void>;

interface TerminalRuntimeRefreshState {
  outputSettledTimer: TerminalRuntimeRefreshTimer | null;
  backoffTimer: TerminalRuntimeRefreshTimer | null;
  backoffIndex: number;
  generation: number;
}

interface TerminalRuntimeRefreshTimerApi {
  setTimeout(callback: () => void, delayMs: number): TerminalRuntimeRefreshTimer;
  clearTimeout(timer: TerminalRuntimeRefreshTimer): void;
}

export interface TerminalRuntimeRefreshSchedulerOptions {
  onRefreshDue: RefreshDueHandler;
  outputSettledDelayMs?: number;
  backoffDelaysMs?: readonly [number, ...number[]];
  timerApi?: TerminalRuntimeRefreshTimerApi;
}

export class TerminalRuntimeRefreshScheduler {
  private readonly states = new Map<string, TerminalRuntimeRefreshState>();
  private readonly onRefreshDue: RefreshDueHandler;
  private readonly outputSettledDelayMs: number;
  private readonly backoffDelaysMs: readonly [number, ...number[]];
  private readonly timerApi: TerminalRuntimeRefreshTimerApi;

  constructor(options: TerminalRuntimeRefreshSchedulerOptions) {
    this.onRefreshDue = options.onRefreshDue;
    this.outputSettledDelayMs = options.outputSettledDelayMs ?? DEFAULT_OUTPUT_SETTLED_DELAY_MS;
    this.backoffDelaysMs = options.backoffDelaysMs ?? DEFAULT_REFRESH_BACKOFF_DELAYS_MS;
    this.timerApi = options.timerApi ?? {
      setTimeout,
      clearTimeout,
    };
  }

  recordActivity(terminalRuntimeId: string): void {
    const state = this.getState(terminalRuntimeId);
    state.generation += 1;
    state.backoffIndex = 0;
    this.clearTimers(state);

    const generation = state.generation;
    state.outputSettledTimer = this.timerApi.setTimeout(() => {
      state.outputSettledTimer = null;
      void this.handleOutputSettled(terminalRuntimeId, generation);
    }, this.outputSettledDelayMs);
  }

  clear(terminalRuntimeId: string): void {
    const state = this.states.get(terminalRuntimeId);
    if (!state) {
      return;
    }
    this.clearTimers(state);
    this.states.delete(terminalRuntimeId);
  }

  clearAll(): void {
    for (const state of this.states.values()) {
      this.clearTimers(state);
    }
    this.states.clear();
  }

  private async handleOutputSettled(terminalRuntimeId: string, generation: number): Promise<void> {
    if (!this.isCurrent(terminalRuntimeId, generation)) {
      return;
    }
    await this.onRefreshDue(terminalRuntimeId);
    if (!this.isCurrent(terminalRuntimeId, generation)) {
      return;
    }
    this.scheduleBackoff(terminalRuntimeId, generation);
  }

  private scheduleBackoff(terminalRuntimeId: string, generation: number): void {
    const state = this.states.get(terminalRuntimeId);
    if (!state) {
      return;
    }

    const delay = this.backoffDelaysMs[state.backoffIndex];
    state.backoffTimer = this.timerApi.setTimeout(() => {
      state.backoffTimer = null;
      void this.handleBackoff(terminalRuntimeId, generation);
    }, delay);
  }

  private async handleBackoff(terminalRuntimeId: string, generation: number): Promise<void> {
    if (!this.isCurrent(terminalRuntimeId, generation)) {
      return;
    }
    await this.onRefreshDue(terminalRuntimeId);

    const state = this.states.get(terminalRuntimeId);
    if (!state || state.generation !== generation) {
      return;
    }

    state.backoffIndex = Math.min(state.backoffIndex + 1, this.backoffDelaysMs.length - 1);
    this.scheduleBackoff(terminalRuntimeId, generation);
  }

  private getState(terminalRuntimeId: string): TerminalRuntimeRefreshState {
    const existing = this.states.get(terminalRuntimeId);
    if (existing) {
      return existing;
    }

    const state: TerminalRuntimeRefreshState = {
      outputSettledTimer: null,
      backoffTimer: null,
      backoffIndex: 0,
      generation: 0,
    };
    this.states.set(terminalRuntimeId, state);
    return state;
  }

  private isCurrent(terminalRuntimeId: string, generation: number): boolean {
    const state = this.states.get(terminalRuntimeId);
    return Boolean(state && state.generation === generation);
  }

  private clearTimers(state: TerminalRuntimeRefreshState): void {
    if (state.outputSettledTimer) {
      this.timerApi.clearTimeout(state.outputSettledTimer);
      state.outputSettledTimer = null;
    }
    if (state.backoffTimer) {
      this.timerApi.clearTimeout(state.backoffTimer);
      state.backoffTimer = null;
    }
  }
}
