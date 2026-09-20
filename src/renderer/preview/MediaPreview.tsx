import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { GitDiffScope, PreviewDiffDocument, PreviewSide } from "../../shared/ipc";
import { mediaPreviewKind } from "../../shared/media-preview";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";
import { formatBytes, formatDuration } from "../utils/format";
import { EmptyState } from "../ui/EmptyState";

interface MediaPreviewProps {
  path: string;
  // Changes pane から選んだ時だけ入る scope。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
  worktreeId: string;
  // 中身が動きうるファイルか。差分テキストと同じ判定で、同じ間隔で追従する。
  poll: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; document: PreviewDiffDocument };

// 要素に読ませて初めて分かる値。動画でなければ幅・高さは 0。
interface MeasuredMedia {
  duration: number | null;
  width: number;
  height: number;
}

// 再生は <audio> / <video> のコントロールに任せ、ここは「どの中身を渡すか」だけを持つ。
// 中身は URL から要素が直接読むので、poll で運ぶのは大きさと URL だけ。
export default function MediaPreview({ path, scope, worktreeId, poll }: MediaPreviewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const fetchDocument = async (): Promise<void> => {
      const result = await window.electronAPI.getPreviewDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }
      const document = resultDataOrNull(result);
      setState(document === null ? { status: "unavailable" } : { status: "ready", document });
    };

    // ファイルや scope が変わったら前のメディアを残さない。ヘッダのファイル名と Reviewed は
    // 差分テキストが届いた時点で新しい選択に進むので、古いメディアを出したままにすると
    // 「別のファイルを見ながらこのファイルを Reviewed にする」ことができてしまう。
    // oxlint-disable-next-line react/set-state-in-effect
    setState({ status: "loading" });

    if (!poll) {
      void fetchDocument();
      return () => {
        cancelled = true;
      };
    }

    const stopPolling = startPollingLoop(fetchDocument, 3000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [path, scope, poll, worktreeId]);

  if (state.status !== "ready") {
    return (
      <EmptyState>
        {state.status === "loading" ? "Loading media…" : "Media preview is not available"}
      </EmptyState>
    );
  }

  const { original, current } = state.document;
  const kind = mediaPreviewKind(path);
  if (kind === null) {
    return <EmptyState>Media preview is not available</EmptyState>;
  }

  // 片側だけ = 追加または削除。中身が同じなら差分ではない。どちらも 1 面で見せる。
  if (original === null || current === null || original.url === current.url) {
    const media = current ?? original;
    if (media === null) {
      return <EmptyState>Media preview is not available</EmptyState>;
    }
    return (
      <div className="media-preview">
        <MediaSideView
          kind={kind}
          media={media}
          label={original === null ? "Added" : current === null ? "Deleted" : null}
        />
      </div>
    );
  }

  return (
    <div className="media-preview">
      <div className="diff-side-columns">
        <MediaSideView kind={kind} media={original} label="Before" />
        <MediaSideView kind={kind} media={current} label="After" />
      </div>
    </div>
  );
}

function MediaSideView({
  kind,
  media,
  label,
}: {
  kind: "audio" | "video";
  media: PreviewSide;
  label: string | null;
}) {
  // 中身が差し替わった時に持ち越す再生位置と再生状態。最後に分かっている値を持ち続ける。
  const positionRef = useRef({ time: 0, playing: false });
  const [failed, setFailed] = useState(false);
  const [measured, setMeasured] = useState<MeasuredMedia | null>(null);

  const rememberPosition = (event: SyntheticEvent<HTMLMediaElement>): void => {
    const element = event.currentTarget;
    positionRef.current = { time: element.currentTime, playing: !element.paused };
  };

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLMediaElement>): void => {
    const element = event.currentTarget;
    setMeasured({
      duration: Number.isFinite(element.duration) ? element.duration : null,
      width: element instanceof HTMLVideoElement ? element.videoWidth : 0,
      height: element instanceof HTMLVideoElement ? element.videoHeight : 0,
    });

    // 作り直されたものを同じ場所から聴き直せるように、位置と再生状態を引き継ぐ。
    // 最初の読み込みでは 0 秒・停止なので、何も起きない。
    const { time, playing } = positionRef.current;
    if (time > 0) {
      element.currentTime = Math.min(time, element.duration || time);
    }
    if (playing) {
      // 差し替え直後の再生は、autoplay の制限や次の差し替えで拒否されることがある。
      // 拒否されたら止まったままにする (ユーザーがもう一度押せる)。
      void element.play().catch(() => {});
    }
  };

  // src が変わると要素が読み直すので、URL に中身の識別子が入っていることが前提。
  const mediaProps = {
    src: media.url,
    controls: true,
    controlsList: "nodownload",
    preload: "metadata" as const,
    onLoadedMetadata: handleLoadedMetadata,
    onTimeUpdate: rememberPosition,
    onPlay: rememberPosition,
    onPause: rememberPosition,
    onError: () => setFailed(true),
  };

  return (
    <div className="diff-side">
      {label && <div className={`diff-side-label ${label.toLowerCase()}`}>{label}</div>}
      {failed ? (
        <div className="media-placeholder">This file cannot be played here</div>
      ) : kind === "audio" ? (
        <audio {...mediaProps} />
      ) : (
        <video {...mediaProps} />
      )}
      <div className="diff-side-meta">{describeSide(media.byteLength, measured)}</div>
    </div>
  );
}

// 画像の「1920 × 1080 · 2.4 MB」と同じ位置に出す。長さと寸法は要素が読み込むまで出せない。
function describeSide(byteLength: number, measured: MeasuredMedia | null): string {
  const parts: string[] = [];
  if (measured !== null && measured.width > 0) {
    parts.push(`${measured.width} × ${measured.height}`);
  }
  if (measured !== null && measured.duration !== null) {
    parts.push(formatDuration(measured.duration));
  }
  parts.push(formatBytes(byteLength));
  return parts.join(" · ");
}
