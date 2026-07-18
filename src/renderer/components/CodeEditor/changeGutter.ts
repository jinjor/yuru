import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  GutterMarker,
  ViewPlugin,
  gutter,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { computeLineChanges, type ChangeKind, type ChangeMark } from "./lineChanges";

// Git base (元内容) が stage / commit などで変わったときに変更行表示へ伝える effect。
export const setOriginalEffect = StateEffect.define<string>();

// 変更行を 2 箇所に表示する: 行番号横のガターと、スクロールバー上の overview ruler。
// どちらも marksField (変更行マークの single source) から導出する。
export function changeTracker(initialOriginal: string): Extension {
  const originalField = StateField.define<string>({
    create: () => initialOriginal,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setOriginalEffect)) {
          return effect.value;
        }
      }
      return value;
    },
  });

  const marksField = StateField.define<ChangeMark[]>({
    create: (state) => computeMarks(state.field(originalField), state.doc),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((effect) => effect.is(setOriginalEffect))) {
        return computeMarks(tr.state.field(originalField), tr.newDoc);
      }
      return value;
    },
  });

  const gutterMarkerField = StateField.define<RangeSet<GutterMarker>>({
    create: (state) => buildGutterMarkers(state.field(marksField), state.doc),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((effect) => effect.is(setOriginalEffect))) {
        return buildGutterMarkers(tr.state.field(marksField), tr.newDoc);
      }
      return value;
    },
  });

  const changeGutter = gutter({
    class: "cm-change-gutter",
    markers: (view) => view.state.field(gutterMarkerField),
  });

  // スクロールバー上に変更位置を重ねる。閲覧側 (SourceViewer) の diff-overview-ruler と
  // 同じ CSS クラスを使い、行番号の割合で位置を近似する。
  const overviewRuler = ViewPlugin.fromClass(
    class {
      private readonly ruler: HTMLElement;

      constructor(view: EditorView) {
        this.ruler = document.createElement("div");
        this.ruler.className = "diff-overview-ruler";
        this.ruler.setAttribute("aria-hidden", "true");
        view.dom.appendChild(this.ruler);
        this.render(view.state);
      }

      update(update: ViewUpdate): void {
        if (update.state.field(marksField) !== update.startState.field(marksField)) {
          this.render(update.state);
        }
      }

      destroy(): void {
        this.ruler.remove();
      }

      private render(state: EditorState): void {
        const totalLines = state.doc.lines;
        this.ruler.replaceChildren();
        for (const mark of groupRulerMarks(state.field(marksField))) {
          const el = document.createElement("span");
          el.className = `diff-overview-mark ${mark.kind === "added" ? "diff-added" : "diff-deleted"}`;
          el.style.top = `${((mark.startLine - 1) / totalLines) * 100}%`;
          el.style.height = `${(mark.lineCount / totalLines) * 100}%`;
          this.ruler.appendChild(el);
        }
      }
    },
  );

  return [originalField, marksField, gutterMarkerField, changeGutter, overviewRuler];
}

function computeMarks(original: string, doc: Text): ChangeMark[] {
  const originalLines = original.split("\n");
  const currentLines: string[] = [];
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    currentLines.push(doc.line(lineNumber).text);
  }
  return computeLineChanges(originalLines, currentLines).marks;
}

class ChangeMarker extends GutterMarker {
  constructor(private readonly kind: ChangeKind) {
    super();
  }

  override eq(other: ChangeMarker): boolean {
    return other.kind === this.kind;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-change-mark cm-change-mark-${this.kind}`;
    return el;
  }
}

const gutterMarkers: Record<ChangeKind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  deleted: new ChangeMarker("deleted"),
  "deleted-end": new ChangeMarker("deleted-end"),
};

function buildGutterMarkers(marks: ChangeMark[], doc: Text): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const mark of marks) {
    const position = doc.line(mark.line).from;
    builder.add(position, position, gutterMarkers[mark.kind]);
  }
  return builder.finish();
}

interface RulerMark {
  // 1-based の開始行
  startLine: number;
  lineCount: number;
  kind: "added" | "deleted";
}

// 連続する追加行は 1 本のバーにまとめる。削除マークは削除跡の境界行を指すので 1 行分で示す。
function groupRulerMarks(marks: ChangeMark[]): RulerMark[] {
  const grouped: RulerMark[] = [];
  for (const mark of marks) {
    const kind = mark.kind === "added" ? "added" : "deleted";
    const last = grouped[grouped.length - 1];
    if (last && last.kind === kind && last.startLine + last.lineCount === mark.line) {
      last.lineCount++;
    } else {
      grouped.push({ startLine: mark.line, lineCount: 1, kind });
    }
  }
  return grouped;
}
