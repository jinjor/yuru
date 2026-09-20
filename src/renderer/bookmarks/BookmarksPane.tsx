import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { AppError, Bookmark } from "../../shared/ipc";
import type { PreviewSelection } from "../previewSelection";
import { EmptyState } from "../ui/EmptyState";
import { GitHubBadge } from "../pull-requests/GitHubBadge";
import { IconButton } from "../ui/IconButton";
import { TextInput } from "../ui/TextInput";

interface BookmarksPaneProps {
  // 一覧はタブのカウントにも要るので、取得と購読は ExplorerPanel が持つ。
  bookmarks: readonly Bookmark[];
  onError: (error: AppError) => void;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  worktreeId: string;
}

interface BookmarkRowProps {
  bookmark: Bookmark;
  onOpen: () => void;
  onRemove: () => void;
  onStartRename: () => void;
}

// 一覧の 1 行。画像はサムネイルとタイトルを横に並べ、リンクはタイトルの下に
// ステータスバッジと URL のメタ行を出す。
function BookmarkRow({ bookmark, onOpen, onRemove, onStartRename }: BookmarkRowProps) {
  const isImage = bookmark.kind === "image";
  return (
    <div className="bookmark-row">
      <button
        type="button"
        className={`code-search-match-row bookmark-open${isImage ? " has-thumbnail" : ""}`}
        title={isImage ? bookmark.imagePath : bookmark.url}
        onClick={onOpen}
      >
        {isImage && <img className="bookmark-thumbnail" src={bookmark.url} alt="" />}
        <span className="bookmark-title">{bookmark.title}</span>
        {!isImage && (bookmark.status || bookmark.title !== bookmark.url) && (
          <span className="bookmark-meta">
            {bookmark.status && <GitHubBadge item={bookmark.status} />}
            {bookmark.title !== bookmark.url && (
              <span className="bookmark-url">{bookmark.url}</span>
            )}
          </span>
        )}
      </button>
      {bookmark.renamable && (
        <IconButton label="Rename bookmark" size="sm" onClick={onStartRename}>
          <Pencil size={12} />
        </IconButton>
      )}
      <IconButton label="Remove bookmark" size="sm" onClick={onRemove}>
        <X size={12} />
      </IconButton>
    </div>
  );
}

// worktree に紐づくブックマークの一覧と、その下の入力欄。入力欄には URL を入れるか、
// 画像を貼り付けて Enter で登録する。ターミナルの URL クリックでも登録できる。
// クリックすると、リンクは既定ブラウザ、画像はプレビューで開く。
export function BookmarksPane({
  bookmarks,
  onError,
  onPreviewSelectionChange,
  worktreeId,
}: BookmarksPaneProps) {
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [composeUrl, setComposeUrl] = useState("");
  // 貼り付けた画像。Enter で登録するまではここに留めておく。
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  // Escape で編集を閉じると、input が外れる際に blur も発火する。その blur で
  // 保存が走ってしまわないようにするための一時的なフラグ。
  const cancellingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  // 追加したものは末尾に入るので、一覧が届いたら末尾まで送って結果を見せる。
  const scrollToEndRef = useRef(false);

  const [previousWorktreeId, setPreviousWorktreeId] = useState(worktreeId);
  if (previousWorktreeId !== worktreeId) {
    setPreviousWorktreeId(worktreeId);
    setEditingUrl(null);
    setComposeUrl("");
    setAttachedImage(null);
  }

  useEffect(() => {
    if (!scrollToEndRef.current) {
      return;
    }
    scrollToEndRef.current = false;
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [bookmarks]);

  // 画像は保存した実体をプレビューで開く。リンクは既定ブラウザ。
  const openBookmark = (bookmark: Bookmark): void => {
    if (bookmark.kind === "image") {
      if (bookmark.imagePath) {
        onPreviewSelectionChange({ path: bookmark.imagePath });
      }
      return;
    }
    void window.electronAPI.openExternal(bookmark.url).catch((error: unknown) => {
      onError({
        code: "unknown",
        message: "Failed to open bookmark.",
        detail: `${bookmark.url}\n${error instanceof Error ? error.message : String(error)}`,
      });
    });
  };

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

  // 入力は成功したときだけ空にする。失敗しても入れ直さずに直せるようにしておく。
  const submitCompose = (): void => {
    if (attachedImage) {
      void window.electronAPI.addImageBookmark(worktreeId, attachedImage).then((result) => {
        if (!result.ok) {
          onError(result.error);
          return;
        }
        setAttachedImage(null);
        scrollToEndRef.current = true;
      });
      return;
    }
    const url = composeUrl.trim();
    if (!url) {
      return;
    }
    void window.electronAPI.addBookmark(worktreeId, url).then((result) => {
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setComposeUrl("");
      scrollToEndRef.current = true;
    });
  };

  const handleComposePaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) {
      // 画像以外の貼り付けは、そのまま入力欄のテキストとして入る。
      return;
    }
    event.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachedImage(reader.result);
      }
    };
    reader.readAsDataURL(image);
  };

  return (
    <div className="bookmarks-pane">
      <div ref={listRef} className="bookmarks-list">
        {bookmarks.length === 0 ? (
          <EmptyState>No bookmarks</EmptyState>
        ) : (
          bookmarks.map((bookmark) =>
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
              <BookmarkRow
                key={bookmark.url}
                bookmark={bookmark}
                onOpen={() => openBookmark(bookmark)}
                onRemove={() => {
                  void window.electronAPI.removeBookmark(worktreeId, bookmark.url);
                }}
                onStartRename={() => {
                  cancellingRef.current = false;
                  setEditingUrl(bookmark.url);
                  setEditingTitle(bookmark.title);
                }}
              />
            ),
          )
        )}
      </div>
      <div
        className={`bookmark-compose${attachedImage ? " attached" : ""}`}
        onPaste={handleComposePaste}
      >
        {attachedImage && (
          <div className="bookmark-compose-attachment">
            <img className="bookmark-compose-thumbnail" src={attachedImage} alt="" />
            <span className="bookmark-compose-label">Pasted image</span>
            <IconButton
              label="Discard image"
              size="sm"
              onClick={() => {
                setAttachedImage(null);
              }}
            >
              <X size={12} />
            </IconButton>
          </div>
        )}
        <TextInput
          value={composeUrl}
          onChange={setComposeUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitCompose();
            } else if (event.key === "Escape") {
              setAttachedImage(null);
              setComposeUrl("");
            }
          }}
          placeholder="Paste a URL or image"
        />
      </div>
    </div>
  );
}
