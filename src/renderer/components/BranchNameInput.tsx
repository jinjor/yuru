import { useEffect, useRef, useState } from "react";
import { generateDefaultBranch } from "../utils/branch";
import { Modal } from "./Modal";

interface BranchNameInputProps {
  error: string | null;
  onCancel: () => void;
  onChange: () => void;
  onSubmit: (branchName: string) => void;
}

export function BranchNameInput({ error, onCancel, onChange, onSubmit }: BranchNameInputProps) {
  const [name, setName] = useState(generateDefaultBranch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select();
    }
  }, []);

  const isValid = /^[a-zA-Z0-9._/-]+$/.test(name.trim()) && !name.trim().endsWith("/");

  const handleSubmit = (): void => {
    const trimmed = name.trim();
    if (trimmed && isValid) {
      onSubmit(trimmed);
    }
  };

  return (
    <Modal onClose={onCancel} topOffset={120}>
      <div className="repo-picker">
        <div className="repo-picker-header">Create Worktree</div>
        <div className="worktree-input-row">
          <input
            ref={inputRef}
            type="text"
            className="worktree-name-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              onChange();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSubmit();
              } else if (event.key === "Escape") {
                onCancel();
              }
            }}
            autoFocus
          />
          <button className="worktree-create-btn" onClick={handleSubmit} disabled={!isValid}>
            Create
          </button>
        </div>
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
