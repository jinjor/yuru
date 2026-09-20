import { ArrowDownToLine, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { YuruUpdateState } from "../../shared/ipc";
import type { RepoListItem } from "../../shared/metadata";
import { hasWorkingSession } from "../repos/repoListState";
import { IconButton } from "../ui/IconButton";
import { YuruUpdateRestartDialog } from "./YuruUpdateRestartDialog";

interface YuruUpdateRowProps {
  // 再起動が止めてしまう作業があるかを、この一覧から見る。
  repos: RepoListItem[];
}

// サイドバー下部の常設導線。Yuru 自身の更新はこの 1 行で完結する。
// 押すと更新の前半 (checkout の更新と build) が走り、終わると `Restart to update` に
// 変わって待つ。いつ再起動するかはユーザーが決める。
export function YuruUpdateRow({ repos }: YuruUpdateRowProps) {
  const [state, setState] = useState<YuruUpdateState>({ phase: "idle" });
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const isReady = state.phase === "ready";
  const isDisabled = state.phase === "unavailable" || state.phase === "updating";

  useEffect(() => {
    // 初期表示は取得、以降は push で置き換える。
    window.electronAPI
      .getYuruUpdateState()
      .then(setState)
      .catch((error: unknown) => {
        console.error("Failed to load the update state.", error);
      });
    return window.electronAPI.onYuruUpdateStateChanged(setState);
  }, []);

  // 動いている session を止めてしまう時だけ確認を挟む。何が動いているかは
  // 左ペインのドットに出ているので、確認には並べない。
  const requestRestart = (): void => {
    if (hasWorkingSession(repos)) {
      setIsRestartConfirmOpen(true);
      return;
    }
    restart();
  };

  return (
    <div className="sidebar-footer-row sidebar-update-row">
      <button
        type="button"
        className="sidebar-update-main"
        disabled={isDisabled}
        onClick={isReady ? requestRestart : startUpdate}
        title={state.reason}
      >
        <YuruUpdateRowIcon phase={state.phase} />
        <span>{rowLabel(state)}</span>
      </button>
      {isReady && (
        // 放置している間に repository が進むことがあるので、もう一度取り直せるようにする。
        <IconButton label="Update again" size="sm" onClick={startUpdate}>
          <RefreshCw size={12} strokeWidth={2} />
        </IconButton>
      )}
      {isRestartConfirmOpen && (
        <YuruUpdateRestartDialog
          onCancel={() => setIsRestartConfirmOpen(false)}
          onRestart={() => {
            setIsRestartConfirmOpen(false);
            restart();
          }}
        />
      )}
    </div>
  );
}

function YuruUpdateRowIcon({ phase }: { phase: YuruUpdateState["phase"] }) {
  if (phase === "updating") {
    return <LoaderCircle className="spinning" size={12} strokeWidth={2} aria-hidden="true" />;
  }
  return <ArrowDownToLine size={12} strokeWidth={2} aria-hidden="true" />;
}

function rowLabel(state: YuruUpdateState): string {
  switch (state.phase) {
    case "updating":
      return "Updating…";
    case "ready":
      return "Restart to update";
    default:
      return "Update Yuru";
  }
}

function startUpdate(): void {
  window.electronAPI.startYuruUpdate().catch((error: unknown) => {
    console.error("Failed to start the update.", error);
  });
}

function restart(): void {
  window.electronAPI.restartForYuruUpdate().catch((error: unknown) => {
    console.error("Failed to restart for the update.", error);
  });
}
