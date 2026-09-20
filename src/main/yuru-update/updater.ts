import type { AppError, Result, YuruUpdateState } from "../../shared/ipc.js";
import type { CanUpdateYuru } from "./can-update.js";

export interface YuruUpdateRunner {
  // 更新の前半 (fetch / pull / audit / npm ci / build)。完了まで待つ。
  updateCheckout(): Promise<Result<void>>;
  // 更新の後半 (Yuru の終了を待って差し替え、起動し直す) を切り離して開始する。
  // 起動できたかどうかだけを返し、完了は待たない。
  startAppReplacement(): Promise<Result<void>>;
}

export interface YuruUpdaterDeps {
  canUpdate: CanUpdateYuru;
  runner: YuruUpdateRunner;
  stateChanged(state: YuruUpdateState): void;
  // 更新は画面に出力を出さないので、失敗はここから error center へ渡す。
  recordError(error: AppError): void;
  quit(): void;
}

// 画面から `yuru latest` 相当を実行する。更新は Yuru の終了を挟んで前半と後半に分かれ、
// 前半が終わった `ready` の状態で止まる。いつ再起動するかはユーザーが決める。
export class YuruUpdater {
  private readonly deps: YuruUpdaterDeps;
  private state: YuruUpdateState;
  private restarting = false;

  constructor(deps: YuruUpdaterDeps) {
    this.deps = deps;
    this.state = deps.canUpdate.ok
      ? { phase: "idle" }
      : { phase: "unavailable", reason: deps.canUpdate.reason };
  }

  getState(): YuruUpdateState {
    return this.state;
  }

  // `ready` からも呼べる。放置している間に repository が進んだ時に取り直すためで、
  // 更新の有無にかかわらず build まで走らせる (build 済みの内容が壊れた時の復旧経路でもある)。
  async start(): Promise<void> {
    if (this.state.phase !== "idle" && this.state.phase !== "ready") {
      return;
    }

    this.setState({ phase: "updating" });
    const result = await this.deps.runner.updateCheckout();
    if (!result.ok) {
      // pull だけ済んで build が失敗した checkout を差し替えさせないよう、ready には戻さない。
      this.setState({ phase: "idle" });
      this.deps.recordError(result.error);
      return;
    }
    this.setState({ phase: "ready" });
  }

  async restart(): Promise<void> {
    if (this.state.phase !== "ready" || this.restarting) {
      return;
    }

    this.restarting = true;
    const result = await this.deps.runner.startAppReplacement();
    if (!result.ok) {
      // build 済みの checkout はそのままなので、ready に留めて押し直せるようにする。
      this.restarting = false;
      this.deps.recordError(result.error);
      return;
    }
    this.deps.quit();
  }

  private setState(state: YuruUpdateState): void {
    this.state = state;
    this.deps.stateChanged(state);
  }
}
