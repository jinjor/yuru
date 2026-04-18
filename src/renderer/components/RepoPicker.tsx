import type { AgentDefinition } from "../../shared/agent";
import type { SessionProvider } from "../../shared/session";

interface RepoPickerProps {
  onCancel: () => void;
  onChangeProvider: (provider: SessionProvider) => void;
  onSelect: (repoPath: string, provider: SessionProvider) => void;
  onSelectWorktree: (repoPath: string, provider: SessionProvider) => void;
  provider: SessionProvider | null;
  providers: AgentDefinition[];
  repos: string[];
}

export function RepoPicker({
  onCancel,
  onChangeProvider,
  onSelect,
  onSelectWorktree,
  provider,
  providers,
  repos,
}: RepoPickerProps) {
  const handleBrowse = async (): Promise<void> => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath && provider) {
      onSelect(folderPath, provider);
    }
  };

  return (
    <div className="repo-picker-overlay" onClick={onCancel}>
      <div className="repo-picker" onClick={(event) => event.stopPropagation()}>
        <div className="repo-picker-header">New Session</div>
        <div className="provider-picker">
          {providers.map((value) => (
            <button
              key={value.id}
              className={`provider-picker-btn ${provider === value.id ? "active" : ""}`}
              onClick={() => onChangeProvider(value.id)}
            >
              {value.label}
            </button>
          ))}
        </div>
        {repos.map((repo) => (
          <div key={repo} className="repo-picker-repo">
            <div
              className={`repo-picker-item ${provider ? "" : "disabled"}`}
              onClick={() => {
                if (!provider) {
                  return;
                }
                onSelect(repo, provider);
              }}
            >
              {repo.split("/").pop()}
              <span className="repo-picker-path">{repo}</span>
            </div>
            <button
              className="repo-picker-worktree-btn"
              onClick={() => {
                if (!provider) {
                  return;
                }
                onSelectWorktree(repo, provider);
              }}
              title={provider ? `New ${provider} session in worktree` : "Choose an agent first"}
              disabled={!provider}
            >
              WT
            </button>
          </div>
        ))}
        <div className="repo-picker-item browse" onClick={handleBrowse}>
          Browse...
        </div>
      </div>
    </div>
  );
}
