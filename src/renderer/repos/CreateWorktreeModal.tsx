import { useEffect, useRef, useState } from "react";
import { generateDefaultBranch } from "./defaultBranch";
import { Modal } from "../ui/Modal";

// worktree の作成方法。new-branch は HEAD から新しい branch を切り、
// from-origin は origin の同名 branch を取り込む (F42)。
export type CreateWorktreeMode = "new-branch" | "from-origin";

interface CreateWorktreeModalProps {
  error: string | null;
  onCancel: () => void;
  onChange: () => void;
  onSubmit: (mode: CreateWorktreeMode, branchName: string) => Promise<void>;
}

export function CreateWorktreeModal({
  error,
  onCancel,
  onChange,
  onSubmit,
}: CreateWorktreeModalProps) {
  const [mode, setMode] = useState<CreateWorktreeMode>("new-branch");
  const [names, setNames] = useState<Record<CreateWorktreeMode, string>>(() => ({
    "new-branch": generateDefaultBranch(),
    "from-origin": "",
  }));
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = names[mode];

  useEffect(() => {
    inputRef.current?.select();
  }, [mode]);

  const isValid = /^[a-zA-Z0-9._/-]+$/.test(name.trim()) && !name.trim().endsWith("/");

  const handleSubmit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !isValid || creating) {
      return;
    }
    setCreating(true);
    try {
      await onSubmit(mode, trimmed);
    } finally {
      setCreating(false);
    }
  };

  const switchMode = (nextMode: CreateWorktreeMode): void => {
    if (creating || nextMode === mode) {
      return;
    }
    setMode(nextMode);
    onChange();
  };

  return (
    <Modal onClose={onCancel} topOffset={120}>
      <div className="repo-picker">
        <div className="repo-picker-header">Create Worktree</div>
        <div className="worktree-mode-tabs">
          <button
            type="button"
            className={`worktree-mode-tab${mode === "new-branch" ? " active" : ""}`}
            onClick={() => switchMode("new-branch")}
          >
            New branch
          </button>
          <button
            type="button"
            className={`worktree-mode-tab${mode === "from-origin" ? " active" : ""}`}
            onClick={() => switchMode("from-origin")}
          >
            From origin
          </button>
        </div>
        <div className="worktree-input-row">
          <input
            ref={inputRef}
            type="text"
            className="worktree-name-input"
            value={name}
            placeholder={mode === "from-origin" ? "branch name on origin" : undefined}
            disabled={creating}
            onChange={(event) => {
              const value = event.target.value;
              setNames((prev) => ({ ...prev, [mode]: value }));
              onChange();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleSubmit();
              } else if (event.key === "Escape") {
                onCancel();
              }
            }}
            autoFocus
          />
          <button
            className="worktree-create-btn"
            onClick={() => void handleSubmit()}
            disabled={!isValid || creating}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {mode === "from-origin" && (
          <div className="worktree-mode-hint">
            Fetches this branch from origin and checks it out
          </div>
        )}
        {name.trim() && !isValid && (
          <div className="worktree-error">
            Letters, digits, dots, underscores, slashes, dashes only
          </div>
        )}
        {error && <div className="worktree-error">{error}</div>}
      </div>
    </Modal>
  );
}
