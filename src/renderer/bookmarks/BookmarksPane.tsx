import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AppError, Bookmark } from "../../shared/ipc";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import { resultDataOrNull } from "../utils/result";

interface BookmarksPaneProps {
  onError: (error: AppError) => void;
  worktreeId: string;
}

// 会話の user / assistant message に出た URL を main が記録したブックマークの一覧。
// クリックで既定ブラウザを開く。追加・並び替えの UI はなく、削除だけできる。
export function BookmarksPane({ onError, worktreeId }: BookmarksPaneProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    let active = true;
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

  if (bookmarks.length === 0) {
    return <EmptyState>No bookmarks</EmptyState>;
  }
  return (
    <div className="file-tree bookmarks-pane">
      {bookmarks.map((bookmark) => (
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
            {bookmark.title !== bookmark.url && (
              <span className="bookmark-url">{bookmark.url}</span>
            )}
          </button>
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
      ))}
    </div>
  );
}
