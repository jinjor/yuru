import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { AppError, Bookmark } from "../../shared/ipc";
import { EmptyState } from "../ui/EmptyState";
import { GitHubBadge } from "../pull-requests/GitHubBadge";
import { IconButton } from "../ui/IconButton";
import { TextInput } from "../ui/TextInput";
import { resultDataOrNull } from "../utils/result";

interface BookmarksPaneProps {
  onError: (error: AppError) => void;
  worktreeId: string;
}

// worktree に紐づくブックマークの一覧。登録はターミナルの URL クリック、または
// YURU_BOOKMARK_AUTO_CAPTURE=1 時に会話の user / assistant message から自動追加される。
// クリックで既定ブラウザを開く。追加・並び替えの UI はなく、削除と (GitHub の
// Issue / PR 以外は) リネームができる。
export function BookmarksPane({ onError, worktreeId }: BookmarksPaneProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  // Escape で編集を閉じると、input が外れる際に blur も発火する。その blur で
  // 保存が走ってしまわないようにするための一時的なフラグ。
  const cancellingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setEditingUrl(null);
    const load = (): void => {
      void window.electronAPI.getBookmarks(worktreeId).then((result) => {
        if (active) {
          setBookmarks(resultDataOrNull(result) ?? []);
        }
      });
    };
    load();
    const unsubscribe = window.electronAPI.onBookmarksChanged((changedWorktreeId) => {
      if (changedWorktreeId === worktreeId) {
        load();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [worktreeId]);

  const submitEditing = (bookmark: Bookmark): void => {
    const title = editingTitle.trim();
    setEditingUrl(null);
    if (!title || title === bookmark.title) {
      return;
    }
    void window.electronAPI.renameBookmark(worktreeId, bookmark.url, title).then((result) => {
      if (!result.ok) {
        onError(result.error);
      }
    });
  };

  if (bookmarks.length === 0) {
    return <EmptyState>No bookmarks</EmptyState>;
  }
  return (
    <div className="file-tree bookmarks-pane">
      {bookmarks.map((bookmark) =>
        editingUrl === bookmark.url ? (
          <div className="bookmark-row bookmark-row-editing" key={bookmark.url}>
            <TextInput
              value={editingTitle}
              onChange={setEditingTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitEditing(bookmark);
                } else if (event.key === "Escape") {
                  cancellingRef.current = true;
                  setEditingUrl(null);
                }
              }}
              onBlur={() => {
                if (cancellingRef.current) {
                  cancellingRef.current = false;
                  return;
                }
                submitEditing(bookmark);
              }}
              autoFocus
            />
          </div>
        ) : (
          <div className="bookmark-row" key={bookmark.url}>
            <button
              type="button"
              className="code-search-match-row bookmark-open"
              title={bookmark.url}
              onClick={() => {
                void window.electronAPI.openExternal(bookmark.url).catch((error: unknown) => {
                  onError({
                    code: "unknown",
                    message: "Failed to open bookmark.",
                    detail: `${bookmark.url}\n${error instanceof Error ? error.message : String(error)}`,
                  });
                });
              }}
            >
              <span className="bookmark-title">{bookmark.title}</span>
              {(bookmark.status || bookmark.title !== bookmark.url) && (
                <span className="bookmark-meta">
                  {bookmark.status && <GitHubBadge item={bookmark.status} />}
                  {bookmark.title !== bookmark.url && (
                    <span className="bookmark-url">{bookmark.url}</span>
                  )}
                </span>
              )}
            </button>
            {bookmark.renamable && (
              <IconButton
                label="Rename bookmark"
                size="sm"
                onClick={() => {
                  cancellingRef.current = false;
                  setEditingUrl(bookmark.url);
                  setEditingTitle(bookmark.title);
                }}
              >
                <Pencil size={12} />
              </IconButton>
            )}
            <IconButton
              label="Remove bookmark"
              size="sm"
              onClick={() => {
                void window.electronAPI.removeBookmark(worktreeId, bookmark.url);
              }}
            >
              <X size={12} />
            </IconButton>
          </div>
        ),
      )}
    </div>
  );
}
