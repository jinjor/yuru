import { useEffect, useState } from "react";
import type { GitDiffScope, PdfPreviewGrant, PreviewSide } from "../../shared/ipc";
import { MAX_PDF_PREVIEW_BYTES } from "../../shared/preview";
import { EmptyState } from "../ui/EmptyState";
import { startPollingLoop } from "../utils/polling";
import { resultDataOrNull } from "../utils/result";

interface PdfPreviewProps {
  path: string;
  scope?: GitDiffScope;
  worktreeId: string;
  poll: boolean;
}

type LoadState = { status: "loading" | "unavailable" } | { status: "ready"; source: PreviewSide };

export default function PdfPreview({ path, scope, worktreeId, poll }: PdfPreviewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect
    setState({ status: "loading" });
    const load = async (): Promise<void> => {
      const result = await window.electronAPI.getPreviewDiffDocument(worktreeId, path, scope);
      if (cancelled) {
        return;
      }
      const document = resultDataOrNull(result);
      // 差分比較はしない。削除された PDF では削除前の版を表示する。
      const source = document?.current ?? document?.original;
      setState(source ? { status: "ready", source } : { status: "unavailable" });
    };
    let stop: (() => void) | undefined;
    if (poll) {
      stop = startPollingLoop(load, 3000);
    } else {
      void load();
    }
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [path, scope, worktreeId, poll]);

  if (state.status !== "ready") {
    return (
      <EmptyState>
        {state.status === "loading" ? "Loading PDF…" : "PDF preview is not available"}
      </EmptyState>
    );
  }
  if (state.source.byteLength > MAX_PDF_PREVIEW_BYTES) {
    return <EmptyState>PDF files larger than 50 MiB cannot be previewed</EmptyState>;
  }
  return (
    <PdfDocument
      key={JSON.stringify([worktreeId, path, scope, state.source.contentId])}
      path={path}
      scope={scope}
      worktreeId={worktreeId}
    />
  );
}

function PdfDocument({ path, scope, worktreeId }: Omit<PdfPreviewProps, "poll">) {
  const [grant, setGrant] = useState<PdfPreviewGrant | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let grantId: string | null = null;
    void window.electronAPI
      .createPdfPreview(worktreeId, path, scope)
      .then((result) => {
        const next = resultDataOrNull(result);
        grantId = next?.id ?? null;
        if (cancelled) {
          if (grantId) {
            void window.electronAPI.releasePdfPreview(grantId);
          }
          return;
        }
        setGrant(next);
        setUnavailable(next === null);
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
      if (grantId) {
        void window.electronAPI.releasePdfPreview(grantId);
      }
    };
  }, [path, scope, worktreeId]);

  if (!grant) {
    return <EmptyState>{unavailable ? "PDF preview is not available" : "Loading PDF…"}</EmptyState>;
  }
  // HTML sandbox 属性は Chromium の PDF plugin 自体を無効にするため付けない。
  // 専用 origin・PDF 固定の MIME・main の通信/遷移制限で隔離し、preload API は公開しない。
  return (
    <iframe
      className="pdf-preview-frame"
      src={`${grant.url}#view=FitH&navpanes=0`}
      referrerPolicy="no-referrer"
      title={`PDF preview of ${path}`}
    />
  );
}
