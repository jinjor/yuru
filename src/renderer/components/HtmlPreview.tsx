import { useEffect, useState } from "react";
import type { HtmlPreviewGrant } from "../../shared/ipc";

interface HtmlPreviewProps {
  content: string;
  path: string;
  worktreeId: string;
}

type PreviewState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; grant: HtmlPreviewGrant };

export default function HtmlPreview({ content, path, worktreeId }: HtmlPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let grantId: string | null = null;
    setState({ status: "loading" });

    void window.electronAPI.createHtmlPreview(worktreeId, path, content).then((result) => {
      if (!result.ok) {
        if (!cancelled) {
          setState({ status: "unavailable" });
        }
        return;
      }

      grantId = result.data.id;
      if (cancelled) {
        void window.electronAPI.releaseHtmlPreview(grantId);
        return;
      }
      setState({ status: "ready", grant: result.data });
    });

    return () => {
      cancelled = true;
      if (grantId) {
        void window.electronAPI.releaseHtmlPreview(grantId);
      }
    };
  }, [content, path, worktreeId]);

  if (state.status !== "ready") {
    return (
      <div className="code-panel-empty">
        <p>{state.status === "loading" ? "Loading preview…" : "Preview is not available"}</p>
      </div>
    );
  }

  return (
    <iframe
      className="html-preview-frame"
      src={state.grant.url}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      title={`Preview of ${path}`}
    />
  );
}
