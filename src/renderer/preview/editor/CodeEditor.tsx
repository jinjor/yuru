import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { useFind } from "../Find";
import { changeTracker, setOriginalEffect } from "./changeGutter";
import { editorFind, findEditorMatches, setEditorFindEffect } from "./find";
import { loadLanguageExtension } from "./language";
import { editorThemeExtensions } from "./theme";

const WRITE_DEBOUNCE_MS = 500;

interface CodeEditorProps {
  // 言語 (シンタックスハイライト) 判定に使うファイル名。
  path: string;
  // gutter の変更行マークの基準 (Git 元内容)。
  originalContent: string;
  // エディタに最初に読み込む内容 (= 作業ツリーの現在のファイル)。seed なので mount 時しか使わない。
  initialContent: string;
  // debounce 後と離脱時に編集後の内容を渡す。どう保存するか (IPC) はエディタは知らない。
  onSave: (content: string) => void;
}

export default function CodeEditor({
  path,
  originalContent,
  initialContent,
  onSave,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [findMatchCount, setFindMatchCount] = useState(0);
  const { isOpen: isFindOpen, query, activeIndex, findBar } = useFind(findMatchCount);
  const hasFindQueryRef = useRef(query.length > 0);
  hasFindQueryRef.current = query.length > 0;
  const previousFindTargetRef = useRef({ query: "", activeIndex: 0 });
  const wasFindOpenRef = useRef(false);
  // seed 値とコールバックは「最新を読むが再マウントの引き金にはしない」ので ref に逃がす。
  const latestRef = useRef({ initialContent, originalContent, onSave });
  latestRef.current = { initialContent, originalContent, onSave };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let pendingContent: string | null = null;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;

    const flushWrite = (): void => {
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      if (pendingContent === null) {
        return;
      }
      const content = pendingContent;
      pendingContent = null;
      latestRef.current.onSave(content);
    };

    const scheduleWrite = (content: string): void => {
      pendingContent = content;
      if (writeTimer) {
        clearTimeout(writeTimer);
      }
      writeTimer = setTimeout(flushWrite, WRITE_DEBOUNCE_MS);
    };

    const languageCompartment = new Compartment();

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: latestRef.current.initialContent,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightSpecialChars(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          editorThemeExtensions(),
          languageCompartment.of([]),
          changeTracker(latestRef.current.originalContent),
          editorFind(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              scheduleWrite(update.state.doc.toString());
              if (hasFindQueryRef.current) {
                setDocumentVersion((version) => version + 1);
              }
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    let cancelled = false;
    const languagePromise = loadLanguageExtension(path);
    if (languagePromise) {
      void languagePromise.then((languageExtension) => {
        if (!cancelled) {
          view.dispatch({ effects: languageCompartment.reconfigure(languageExtension) });
        }
      });
    }

    return () => {
      cancelled = true;
      // 離脱時に未書き込みの内容を確実にディスクへ流す (未保存状態を作らない)。
      flushWrite();
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  // Git base (元内容) の更新を gutter へ反映する。doc は seed 済みなので触らない。
  const appliedOriginalRef = useRef(originalContent);
  useEffect(() => {
    if (appliedOriginalRef.current === originalContent) {
      return;
    }
    appliedOriginalRef.current = originalContent;
    viewRef.current?.dispatch({ effects: setOriginalEffect.of(originalContent) });
  }, [originalContent]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const matches = findEditorMatches(view.state.doc, query);
    setFindMatchCount(matches.length);

    const previousTarget = previousFindTargetRef.current;
    const targetChanged =
      previousTarget.query !== query || previousTarget.activeIndex !== activeIndex;
    previousFindTargetRef.current = { query, activeIndex };

    const activeMatch = matches[activeIndex];
    const findEffect = setEditorFindEffect.of({ matches, activeIndex });
    view.dispatch({
      effects:
        targetChanged && activeMatch
          ? [findEffect, EditorView.scrollIntoView(activeMatch.from, { y: "center" })]
          : findEffect,
    });
  }, [activeIndex, documentVersion, query]);

  useEffect(() => {
    if (wasFindOpenRef.current && !isFindOpen) {
      viewRef.current?.focus();
    }
    wasFindOpenRef.current = isFindOpen;
  }, [isFindOpen]);

  return (
    <div className="code-editor-wrap">
      {findBar}
      <div ref={hostRef} className="code-editor" />
    </div>
  );
}
