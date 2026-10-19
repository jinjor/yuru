import { useEffect, useRef, useState } from "react";
import type { GitBlameCommit } from "../../../shared/ipc";
import { GitHubBadge } from "../../pull-requests/GitHubBadge";
import { formatRelativeTime } from "../../utils/format";
import type { BlameLoad } from "./useBlame";
import type { CommitDetails } from "./useCommitDetails";

const CARD_OPEN_DELAY_MS = 300;
const CARD_CLOSE_DELAY_MS = 200;

interface BlameAnnotationProps {
  load: BlameLoad;
  commitDetails: ReadonlyMap<string, CommitDetails>;
  onOpenCard: (oid: string) => void;
  // 表示側の行番号。
  lineNumber: number;
}

// フォーカス行の行末に出す注記。
export function BlameAnnotation({
  load,
  commitDetails,
  onOpenCard,
  lineNumber,
}: BlameAnnotationProps) {
  if (load.status === "loading") {
    return <span className="blame-annotation">Loading blame…</span>;
  }
  if (load.status === "failed") {
    return <span className="blame-annotation">Blame is not available</span>;
  }
  if (load.blame === null) {
    return null;
  }

  // 末尾の改行の後ろの行は、git の数え方では行ではないので blame に無い。
  const commitIndex = load.blame.lines[lineNumber - 1];
  if (commitIndex === undefined) {
    return null;
  }
  if (commitIndex === null) {
    return <span className="blame-annotation">Not committed yet</span>;
  }
  const commit = load.blame.commits[commitIndex];
  if (commit.historyTruncated) {
    return <span className="blame-annotation">No history in this shallow clone</span>;
  }
  return (
    // 取り直しで行の commit が変わったら、カードの開閉や相対時刻の基準も作り直す。
    <CommitAnnotation
      key={commit.oid}
      commit={commit}
      details={commitDetails.get(commit.oid)}
      onOpenCard={onOpenCard}
    />
  );
}

interface CommitAnnotationProps {
  commit: GitBlameCommit;
  details: CommitDetails | undefined;
  onOpenCard: (oid: string) => void;
}

// ホバーでカードを開く。カードは注記の子要素なので、注記からカードへポインタを移しても
// 注記の mouseleave にはならない。間の隙間を通る分だけ閉じるのを遅らせる。
// クリックした場所に注記が出ると、ポインタを動かしていなくても mouseenter が来るので、
// 開くのは注記の上でマウスが動いてからにする。
function CommitAnnotation({ commit, details, onOpenCard }: CommitAnnotationProps) {
  const [isCardOpen, setIsCardOpen] = useState(false);
  // 相対時刻は、注記が出た時点を基準にする。
  const [shownAt] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待っている切り替えが済んだ後に、カードが開いているか。
  const willBeOpenRef = useRef(false);

  const setCardOpenLater = (open: boolean, delayMs: number): void => {
    willBeOpenRef.current = open;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setIsCardOpen(open);
      if (open) {
        onOpenCard(commit.oid);
      }
    }, delayMs);
  };

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <span
      className="blame-annotation interactive"
      onMouseMove={() => {
        if (!willBeOpenRef.current) {
          setCardOpenLater(true, CARD_OPEN_DELAY_MS);
        }
      }}
      onMouseLeave={() => setCardOpenLater(false, CARD_CLOSE_DELAY_MS)}
    >
      {commit.author}, {formatRelativeTime(commit.authorTime, shownAt)} • {commit.summary}
      {isCardOpen && <BlameCard commit={commit} details={details} />}
    </span>
  );
}

// ソース表示のスクロール領域に切り取られないよう、カードは top layer に出す。
// 位置は CSS の anchor positioning で注記に合わせる。ref の関数が描画ごとに変わると
// 開き直しになるので、モジュールの関数にしておく。
function showPopover(element: HTMLElement | null): void {
  element?.showPopover();
}

function openPullRequest(url: string): void {
  void window.electronAPI.openExternal(url);
}

function BlameCard({
  commit,
  details,
}: {
  commit: GitBlameCommit;
  details: CommitDetails | undefined;
}) {
  // メッセージ全文が届くまで (または取れなかったとき) は、blame に載っている 1 行目を出す。
  const message = details?.message ?? commit.summary;
  const pullRequests = details?.pullRequests;

  return (
    <div ref={showPopover} popover="manual" className="blame-card">
      <div className="blame-card-message">{message}</div>
      <div className="blame-card-meta">
        <span>{commit.author}</span>
        <span>{new Date(commit.authorTime).toLocaleString()}</span>
        <span className="blame-card-oid">{commit.oid.slice(0, 7)}</span>
      </div>
      {pullRequests && pullRequests.length > 0 && (
        <ul className="blame-card-pull-requests">
          {pullRequests.map(({ status, title, bodyText }) => (
            <li key={status.url} className="blame-card-pull-request">
              <div className="blame-card-pull-request-heading">
                <GitHubBadge item={status} onClick={() => openPullRequest(status.url)} />
                <button
                  type="button"
                  className="blame-card-pull-request-title"
                  title={status.url}
                  onClick={() => openPullRequest(status.url)}
                >
                  {title}
                </button>
              </div>
              {bodyText.trim() && <p className="blame-card-pull-request-body">{bodyText.trim()}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
