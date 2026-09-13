import { Activity, type ReactNode, type RefObject, useCallback, useEffect, useState } from "react";
import { Bookmark, FileDiff, Folder, Search } from "lucide-react";
import type {
  AppError,
  Bookmark as BookmarkItem,
  GitPathState,
  GitReviewState,
} from "../../shared/ipc";
import { useCommandShortcut } from "../utils/useCommandShortcut";
import { useElementSize } from "../utils/useElementSize";
import type { PreviewSelection } from "../previewSelection";
import {
  buildChangedFiles,
  buildConflictedFiles,
  buildStagedFiles,
  buildUnstagedFiles,
} from "../changes/gitStatus";
import { ChangesPane } from "../changes/ChangesPane";
import { BookmarksPane } from "../bookmarks/BookmarksPane";
import { FilesPane } from "../files/FilesPane";
import { SearchPane } from "../search/SearchPane";
import { Tab } from "../ui/Tab";
import { resultDataOrNull } from "../utils/result";

type ExplorerTab = "changes" | "files" | "search" | "bookmarks";

// タブ列の見せ方。幅が足りなくなるたびに、右の段階へ落ちる。
// label: ラベルと件数 / count: アイコンと件数 / icon: アイコンだけ。
// icon はどんな件数でも 140px で収まるので、ここまで来れば必ず入る。
type ExplorerTabStage = "label" | "count" | "icon";

interface ExplorerTabItem {
  // 件数のバッジ。0 件のときは出さない (件数が無いことはバッジが無いことで伝わる)。
  count?: { label: string; value: number };
  icon: ReactNode;
  key: ExplorerTab;
  label: string;
}

// タブの中身。ラベルが出ない段階でも、読み上げと tooltip は Tab の label が持つ。
function ExplorerTabContent({ item, stage }: { item: ExplorerTabItem; stage: ExplorerTabStage }) {
  return (
    <>
      {stage === "label" ? item.label : <span className="panel-tab-icon">{item.icon}</span>}
      {stage !== "icon" && item.count !== undefined && item.count.value > 0 && (
        <span className="panel-tab-count" aria-label={item.count.label}>
          {item.count.value}
        </span>
      )}
    </>
  );
}

// 幅を測るためだけのタブ列。実物と同じ Tab を使うので、寸法が実物からずれない。
// 段階を固定して置くため、実物が畳まれてもこちらの幅は動かない。これが動くと
// 「畳む → 収まる → 戻す」の往復になる。
// 実物と同じ .panel-tabs にはしない。そうすると「タブ列」を指す selector が
// 実物と控えの両方に当たってしまう。
function ExplorerTabProbe({
  items,
  stage,
  ref,
}: {
  items: readonly ExplorerTabItem[];
  stage: ExplorerTabStage;
  ref: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={ref} className="panel-tabs-probe">
      {items.map((item) => (
        <Tab key={item.key} label={item.label} selected={false} onSelect={noop}>
          <ExplorerTabContent item={item} stage={stage} />
        </Tab>
      ))}
    </div>
  );
}

function noop(): void {}

interface ExplorerPanelProps {
  gitPathStates: readonly GitPathState[];
  onError: (error: AppError) => void;
  onPreviewSelectionChange: (selection: PreviewSelection | null) => void;
  previewSelection: PreviewSelection | null;
  reviewState: GitReviewState | null;
  width: number;
  worktreeId: string;
}

export function ExplorerPanel({
  gitPathStates,
  onError,
  onPreviewSelectionChange,
  previewSelection,
  reviewState,
  width,
  worktreeId,
}: ExplorerPanelProps) {
  const [activeTab, setActiveTab] = useState<ExplorerTab>("changes");
  // 検索入力へフォーカスを促す合図。hidden の間 SearchPane の effect は動かないため、
  // ショートカットの受け口は常にマウントされているこちらに置く。
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const selectTab = useCallback((tab: ExplorerTab): void => {
    setActiveTab(tab);
    if (tab === "search") {
      setSearchFocusRequest((prev) => prev + 1);
    }
  }, []);
  const showSearch = useCallback(() => selectTab("search"), [selectTab]);
  useCommandShortcut({ key: "f", shift: true }, showSearch);
  // タブのカウントにも使うので、一覧の取得と購読はここが持つ。
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
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

  const [panelRef, panelSize] = useElementSize<HTMLDivElement>();
  const [headerRef, headerSize] = useElementSize<HTMLDivElement>();
  const contentHeight = Math.max(panelSize.height - headerSize.height, 0);
  const changedFiles = buildChangedFiles(gitPathStates);
  const conflictedFiles = buildConflictedFiles(gitPathStates);
  const stagedFiles = buildStagedFiles(gitPathStates);
  const unstagedFiles = buildUnstagedFiles(gitPathStates);

  const tabItems: readonly ExplorerTabItem[] = [
    {
      count: { label: `${changedFiles.length} changed files`, value: changedFiles.length },
      icon: <FileDiff size={14} />,
      key: "changes",
      label: "Changes",
    },
    { icon: <Folder size={14} />, key: "files", label: "Files" },
    { icon: <Search size={14} />, key: "search", label: "Search" },
    {
      count: { label: `${bookmarks.length} bookmarks`, value: bookmarks.length },
      icon: <Bookmark size={14} />,
      key: "bookmarks",
      label: "Bookmarks",
    },
  ];
  // 置ける幅と、各段階に要る幅を測って、いちばん多く見せられる段階を選ぶ。
  // 要る幅は件数の桁数で変わるので、固定の閾値では余裕があるうちから畳むことになる。
  const [tabsRef, tabsSize] = useElementSize<HTMLDivElement>();
  const [labelProbeRef, labelProbeSize] = useElementSize<HTMLDivElement>();
  const [countProbeRef, countProbeSize] = useElementSize<HTMLDivElement>();
  const tabStage: ExplorerTabStage =
    tabsSize.width === 0 || labelProbeSize.width <= tabsSize.width
      ? "label"
      : countProbeSize.width <= tabsSize.width
        ? "count"
        : "icon";

  return (
    <aside
      ref={panelRef}
      className={`changes-panel ${tabStage === "label" ? "" : "narrow"}`}
      style={{ width, minWidth: width }}
    >
      <div ref={headerRef} className="panel-header panel-header-stack">
        <div ref={tabsRef} className="panel-tabs">
          {tabItems.map((item) => (
            <Tab
              key={item.key}
              label={item.label}
              selected={activeTab === item.key}
              onSelect={() => selectTab(item.key)}
            >
              <ExplorerTabContent item={item} stage={tabStage} />
            </Tab>
          ))}
        </div>
        <div className="panel-tabs-probes" aria-hidden="true">
          <ExplorerTabProbe items={tabItems} stage="label" ref={labelProbeRef} />
          <ExplorerTabProbe items={tabItems} stage="count" ref={countProbeRef} />
        </div>
      </div>
      <Activity mode={activeTab === "changes" ? "visible" : "hidden"}>
        <ChangesPane
          conflictedFiles={conflictedFiles}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          reviewState={reviewState}
          stagedFiles={stagedFiles}
          unstagedFiles={unstagedFiles}
        />
      </Activity>
      <Activity mode={activeTab === "search" ? "visible" : "hidden"}>
        <SearchPane
          focusRequest={searchFocusRequest}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          worktreeId={worktreeId}
        />
      </Activity>
      <Activity mode={activeTab === "bookmarks" ? "visible" : "hidden"}>
        <BookmarksPane
          bookmarks={bookmarks}
          onError={onError}
          onPreviewSelectionChange={onPreviewSelectionChange}
          worktreeId={worktreeId}
        />
      </Activity>
      <Activity mode={activeTab === "files" ? "visible" : "hidden"}>
        <FilesPane
          changedFiles={changedFiles}
          gitPathStates={gitPathStates}
          height={contentHeight || 400}
          onPreviewSelectionChange={onPreviewSelectionChange}
          previewSelection={previewSelection}
          worktreeId={worktreeId}
        />
      </Activity>
    </aside>
  );
}
