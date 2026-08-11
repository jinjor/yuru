import { useEffect, useState } from "react";
import type { GitDiffScope, ImageDiffDocument, ImageDiffSide } from "../../shared/ipc";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";
import { EmptyState } from "../ui/EmptyState";

interface ImagePreviewProps {
  path: string;
  // Changes pane から選んだ時だけ入る scope。なしは HEAD ↔ 作業ツリーの合算 diff。
  scope?: GitDiffScope;
  worktreeId: string;
  // 中身が動きうるファイルか。差分テキストと同じ判定で、同じ間隔で追従する。
  poll: boolean;
}

// 画像の自然サイズ (px)。デコードできない画像は null になる。
interface ImageSize {
  width: number;
  height: number;
}

interface ImageLayer {
  image: ImageDiffSide;
  size: ImageSize | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; original: ImageLayer | null; current: ImageLayer | null };

export default function ImagePreview({ path, scope, worktreeId, poll }: ImagePreviewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // この effect が表示に反映済みの内容。同じ内容を取り直した時は測り直しも描き直しもしない。
    let shown: { original: string | null; current: string | null } | null = null;

    const fetchImage = async (): Promise<void> => {
      const result = await window.electronAPI.getImageDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }

      const document = resultDataOrNull(result);
      if (document === null) {
        setState({ status: "unavailable" });
        return;
      }
      if (shown !== null && isSameContent(shown, document)) {
        return;
      }

      // 自然サイズは <img> に読ませて測る。両側そろってから出して、表示後の寸法変化を避ける。
      const [original, current] = await Promise.all([
        toLayer(document.original),
        toLayer(document.current),
      ]);
      if (cancelled) {
        return;
      }
      shown = {
        original: document.original?.dataUrl ?? null,
        current: document.current?.dataUrl ?? null,
      };
      setState({ status: "ready", original, current });
    };

    // ファイルや scope が変わったら前の画像を残さない。ヘッダのファイル名と Reviewed は
    // 差分テキストが届いた時点で新しい選択に進むので、古い画像を出したままにすると
    // 「別のファイルを見ながらこのファイルを Reviewed にする」ことができてしまう。
    setState({ status: "loading" });

    if (!poll) {
      void fetchImage();
      return () => {
        cancelled = true;
      };
    }

    const stopPolling = startPollingLoop(fetchImage, 3000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [path, scope, poll, worktreeId]);

  if (state.status !== "ready") {
    return (
      <EmptyState>
        {state.status === "loading" ? "Loading image…" : "Image preview is not available"}
      </EmptyState>
    );
  }

  const { original, current } = state;

  // 片側だけ = 追加または削除。中身が同じなら差分ではない。どちらも 1 枚で見せる。
  if (original === null || current === null || original.image.dataUrl === current.image.dataUrl) {
    const layer = current ?? original;
    if (layer === null) {
      return <EmptyState>Image preview is not available</EmptyState>;
    }
    return (
      <div className="image-preview">
        <ImageSideView
          layer={layer}
          box={layer.size}
          label={original === null ? "Added" : current === null ? "Deleted" : null}
        />
      </div>
    );
  }

  const box = combinedSize(original, current);
  return (
    <div className="image-preview">
      <div className="image-diff-columns">
        <ImageSideView layer={original} box={box} label="Before" />
        <ImageSideView layer={current} box={box} label="After" />
      </div>
    </div>
  );
}

function ImageSideView({
  layer,
  box,
  label,
}: {
  layer: ImageLayer;
  // 両側を同じ倍率で見せるための共通の座標系。null なら自然サイズが分からないので成り行きで置く。
  box: ImageSize | null;
  label: string | null;
}) {
  return (
    <div className="image-side">
      {label && <div className={`image-side-label ${label.toLowerCase()}`}>{label}</div>}
      {box && layer.size ? (
        <div
          className="image-stage"
          style={{
            // 拡大はせず、パネルが狭いときだけ縮める。
            width: `min(100%, ${box.width}px)`,
            aspectRatio: `${box.width} / ${box.height}`,
          }}
        >
          {/* box に対する相対サイズで左上に置く。寸法が違っても倍率がそろい、差がそのまま見える。 */}
          <img
            className="image-layer"
            src={layer.image.dataUrl}
            alt=""
            style={{
              width: `${(layer.size.width / box.width) * 100}%`,
              height: `${(layer.size.height / box.height) * 100}%`,
            }}
          />
        </div>
      ) : (
        <div className="image-stage auto">
          <img className="image-auto" src={layer.image.dataUrl} alt="" />
        </div>
      )}
      <div className="image-side-meta">{describeLayer(layer)}</div>
    </div>
  );
}

function isSameContent(
  shown: { original: string | null; current: string | null },
  document: ImageDiffDocument,
): boolean {
  return (
    shown.original === (document.original?.dataUrl ?? null) &&
    shown.current === (document.current?.dataUrl ?? null)
  );
}

async function toLayer(image: ImageDiffSide | null): Promise<ImageLayer | null> {
  if (image === null) {
    return null;
  }
  return { image, size: await loadImageSize(image.dataUrl) };
}

// デコードできない画像と、幅・高さを持たない画像は null (寸法を出さず、倍率もそろえない)。
function loadImageSize(dataUrl: string): Promise<ImageSize | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function combinedSize(original: ImageLayer, current: ImageLayer): ImageSize | null {
  if (original.size === null || current.size === null) {
    return null;
  }
  return {
    width: Math.max(original.size.width, current.size.width),
    height: Math.max(original.size.height, current.size.height),
  };
}

function describeLayer(layer: ImageLayer): string {
  const bytes = formatBytes(layer.image.byteLength);
  return layer.size ? `${layer.size.width} × ${layer.size.height} · ${bytes}` : bytes;
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`;
  }
  return `${(byteLength / 1024 / 1024).toFixed(1)} MB`;
}
