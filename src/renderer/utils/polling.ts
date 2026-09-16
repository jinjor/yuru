// 前回の実行完了を待ってから次を予約する自走ループ。固定間隔の setInterval と違い、
// 1 回の実行が interval を超えても並走して積み上がらない。待ち時間は現在の間隔と
// 前回の所要時間の長い方なので、実行が占める時間は最大でも半分に抑えられる。
//
// 省エネ方針が有効なとき (既定)、間隔は実行のたびに 2 倍ずつ伸ばし、MAX_INTERVAL_MS で
// 頭打ちにする（バックオフ）。ウィンドウにフォーカスが戻った・再表示されたタイミングでは
// 間隔を初期値に戻して即座に 1 回実行し、見た目の鮮度を優先する。
// YURU_SAVE_ENERGY=0 で起動するとこの方針を無効にし、従来の固定間隔に戻る。
// 停止用の関数を返す。
const MAX_INTERVAL_MS = 60_000;

// 省エネの polling 方針 (間隔のバックオフとフォーカス連動の即時 refresh) を使うか。
// preload が YURU_SAVE_ENERGY を読んで window.__yuruSaveEnergy に置く。
// テストなど window が無い環境では有効扱いにする。
export function isEnergySavingPollingEnabled(): boolean {
  return typeof window === "undefined" || window.__yuruSaveEnergy !== false;
}

export function startPollingLoop(
  run: () => Promise<void>,
  intervalMs: number,
  shouldRun: () => boolean = () => document.visibilityState === "visible",
): () => void {
  const energySaving = isEnergySavingPollingEnabled();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentIntervalMs = intervalMs;

  const scheduleNext = (elapsedMs: number): void => {
    // 次の待ち時間は現在の間隔と今回の所要時間の長い方。省エネ方針では予約してから間隔を
    // 倍にするので、実際の待ち時間は intervalMs, intervalMs*2, ... と伸びていく。
    timer = setTimeout(() => void tick(false), Math.max(currentIntervalMs, elapsedMs));
    if (energySaving) {
      currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_INTERVAL_MS);
    }
  };

  const tick = async (isFirst: boolean): Promise<void> => {
    const startedAt = Date.now();
    try {
      // 初回は初期表示のデータを作るため必ず実行し、以降は実行条件を満たすときだけ実行する。
      if (isFirst || shouldRun()) {
        await run();
      }
    } catch (error) {
      // 失敗してもポーリングは止めない。エラーは握りつぶさず console に残す。
      console.error(error);
    }
    if (stopped) {
      return;
    }
    scheduleNext(Date.now() - startedAt);
  };

  const resetAndRunNow = (): void => {
    if (stopped || !shouldRun()) {
      return;
    }
    currentIntervalMs = intervalMs;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    void tick(false);
  };
  let removeListeners: (() => void) | null = null;
  if (energySaving) {
    // テスト環境のように window が無い場面でもループ自体は動くようにする。
    // visibilitychange は document、focus は window で発火する。
    const focusTarget: Pick<Document, "addEventListener" | "removeEventListener"> =
      typeof window === "undefined" ? document : window;
    focusTarget.addEventListener("focus", resetAndRunNow);
    document.addEventListener("visibilitychange", resetAndRunNow);
    removeListeners = () => {
      focusTarget.removeEventListener("focus", resetAndRunNow);
      document.removeEventListener("visibilitychange", resetAndRunNow);
    };
  }

  void tick(true);

  return () => {
    stopped = true;
    removeListeners?.();
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}

// フォーカス中のウィンドウが画面に見えている間だけ true。git 系の重いポーリング用。
export function isWindowFocusedAndVisible(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}
