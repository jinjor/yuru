// 前回の実行完了を待ってから次を予約する自走ループ。固定間隔の setInterval と違い、
// 1 回の実行が interval を超えても並走して積み上がらない。待ち時間は interval と
// 前回の所要時間の長い方なので、実行が占める時間は最大でも半分に抑えられる。
// 停止用の関数を返す。
export function startPollingLoop(run: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (isFirst: boolean): Promise<void> => {
    const startedAt = Date.now();
    try {
      // 初回は初期表示のデータを作るため必ず実行し、以降は非表示中の実行を省く。
      if (isFirst || document.visibilityState === "visible") {
        await run();
      }
    } catch (error) {
      // 失敗してもポーリングは止めない。エラーは握りつぶさず console に残す。
      console.error(error);
    }
    if (stopped) {
      return;
    }
    timer = setTimeout(() => void tick(false), Math.max(intervalMs, Date.now() - startedAt));
  };

  void tick(true);

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
