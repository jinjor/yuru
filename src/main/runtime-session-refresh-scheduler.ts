const DEFAULT_OUTPUT_SETTLED_DELAY_MS = 1200;
const DEFAULT_REFRESH_BACKOFF_DELAYS_MS = [
  15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
] as const;

type RuntimeSessionRefreshTimer = ReturnType<typeof setTimeout>;
type RefreshDueHandler = (runtimeSessionId: string) => void | Promise<void>;

interface RuntimeSessionRefreshState {
  outputSettledTimer: RuntimeSessionRefreshTimer | null;
  backoffTimer: RuntimeSessionRefreshTimer | null;
  backoffIndex: number;
  generation: number;
}

interface RuntimeSessionRefreshTimerApi {
  setTimeout(callback: () => void, delayMs: number): RuntimeSessionRefreshTimer;
  clearTimeout(timer: RuntimeSessionRefreshTimer): void;
}

export interface RuntimeSessionRefreshSchedulerOptions {
  onRefreshDue: RefreshDueHandler;
  outputSettledDelayMs?: number;
  backoffDelaysMs?: readonly [number, ...number[]];
  timerApi?: RuntimeSessionRefreshTimerApi;
}

export class RuntimeSessionRefreshScheduler {
  private readonly states = new Map<string, RuntimeSessionRefreshState>();
  private readonly onRefreshDue: RefreshDueHandler;
  private readonly outputSettledDelayMs: number;
  private readonly backoffDelaysMs: readonly [number, ...number[]];
  private readonly timerApi: RuntimeSessionRefreshTimerApi;

  constructor(options: RuntimeSessionRefreshSchedulerOptions) {
    this.onRefreshDue = options.onRefreshDue;
    this.outputSettledDelayMs = options.outputSettledDelayMs ?? DEFAULT_OUTPUT_SETTLED_DELAY_MS;
    this.backoffDelaysMs = options.backoffDelaysMs ?? DEFAULT_REFRESH_BACKOFF_DELAYS_MS;
    this.timerApi = options.timerApi ?? {
      setTimeout,
      clearTimeout,
    };
  }

  recordActivity(runtimeSessionId: string): void {
    const state = this.getState(runtimeSessionId);
    state.generation += 1;
    state.backoffIndex = 0;
    this.clearTimers(state);

    const generation = state.generation;
    state.outputSettledTimer = this.timerApi.setTimeout(() => {
      state.outputSettledTimer = null;
      void this.handleOutputSettled(runtimeSessionId, generation);
    }, this.outputSettledDelayMs);
  }

  clear(runtimeSessionId: string): void {
    const state = this.states.get(runtimeSessionId);
    if (!state) {
      return;
    }
    this.clearTimers(state);
    this.states.delete(runtimeSessionId);
  }

  clearAll(): void {
    for (const state of this.states.values()) {
      this.clearTimers(state);
    }
    this.states.clear();
  }

  private async handleOutputSettled(runtimeSessionId: string, generation: number): Promise<void> {
    if (!this.isCurrent(runtimeSessionId, generation)) {
      return;
    }
    await this.onRefreshDue(runtimeSessionId);
    if (!this.isCurrent(runtimeSessionId, generation)) {
      return;
    }
    this.scheduleBackoff(runtimeSessionId, generation);
  }

  private scheduleBackoff(runtimeSessionId: string, generation: number): void {
    const state = this.states.get(runtimeSessionId);
    if (!state) {
      return;
    }

    const delay = this.backoffDelaysMs[state.backoffIndex];
    state.backoffTimer = this.timerApi.setTimeout(() => {
      state.backoffTimer = null;
      void this.handleBackoff(runtimeSessionId, generation);
    }, delay);
  }

  private async handleBackoff(runtimeSessionId: string, generation: number): Promise<void> {
    if (!this.isCurrent(runtimeSessionId, generation)) {
      return;
    }
    await this.onRefreshDue(runtimeSessionId);

    const state = this.states.get(runtimeSessionId);
    if (!state || state.generation !== generation) {
      return;
    }

    state.backoffIndex = Math.min(state.backoffIndex + 1, this.backoffDelaysMs.length - 1);
    this.scheduleBackoff(runtimeSessionId, generation);
  }

  private getState(runtimeSessionId: string): RuntimeSessionRefreshState {
    const existing = this.states.get(runtimeSessionId);
    if (existing) {
      return existing;
    }

    const state: RuntimeSessionRefreshState = {
      outputSettledTimer: null,
      backoffTimer: null,
      backoffIndex: 0,
      generation: 0,
    };
    this.states.set(runtimeSessionId, state);
    return state;
  }

  private isCurrent(runtimeSessionId: string, generation: number): boolean {
    const state = this.states.get(runtimeSessionId);
    return Boolean(state && state.generation === generation);
  }

  private clearTimers(state: RuntimeSessionRefreshState): void {
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
