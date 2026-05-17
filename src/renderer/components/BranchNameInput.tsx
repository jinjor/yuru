import { useEffect, useRef, useState } from "react";
import type { AgentDefinition } from "../../shared/agent";
import type { SessionProvider } from "../../shared/session";
import { generateDefaultBranch } from "../utils/branch";
import { Modal } from "./Modal";

interface BranchNameInputProps {
  error: string | null;
  providers: AgentDefinition[];
  onCancel: () => void;
  onChange: () => void;
  onSubmit: (branchName: string, provider: SessionProvider) => void;
}

export function BranchNameInput({ error, providers, onCancel, onChange, onSubmit }: BranchNameInputProps) {
  const [name, setName] = useState(generateDefaultBranch);
  const [provider, setProvider] = useState<SessionProvider | null>(providers[0]?.id ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select();
    }
  }, []);

  const isValid = /^[a-zA-Z0-9._/-]+$/.test(name.trim()) && !name.trim().endsWith("/");

  const handleSubmit = (): void => {
    const trimmed = name.trim();
    if (trimmed && isValid && provider) {
      onSubmit(trimmed, provider);
    }
  };

  return (
    <Modal onClose={onCancel} topOffset={120}>
      <div className="repo-picker">
        <div className="repo-picker-header">Create Worktree</div>
        <div className="provider-picker">
          {providers.map((p) => (
            <button
              key={p.id}
              className={`provider-picker-btn ${provider === p.id ? "active" : ""}`}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
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
          <button
            className="worktree-create-btn"
            onClick={handleSubmit}
            disabled={!isValid || !provider}
          >
            Create
          </button>
        </div>
        {name.trim() && !isValid && (
          <div className="worktree-error">Letters, digits, dots, underscores, slashes, dashes only</div>
        )}
        {error && <div className="worktree-error">{error}</div>}
      </div>
    </Modal>
  );
}
