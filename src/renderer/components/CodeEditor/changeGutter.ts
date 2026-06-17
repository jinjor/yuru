import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from "@codemirror/state";
import { GutterMarker, gutter } from "@codemirror/view";
import { computeLineChanges, type ChangeKind } from "./lineChanges";

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

const markers: Record<ChangeKind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  deleted: new ChangeMarker("deleted"),
  "deleted-end": new ChangeMarker("deleted-end"),
};

function computeMarkers(original: string, doc: Text): RangeSet<GutterMarker> {
  const originalLines = original.split("\n");
  const currentLines: string[] = [];
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    currentLines.push(doc.line(lineNumber).text);
  }

  const { marks } = computeLineChanges(originalLines, currentLines);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const mark of marks) {
    const position = doc.line(mark.line).from;
    builder.add(position, position, markers[mark.kind]);
  }

  return builder.finish();
}

// Git base (元内容) が stage / commit などで変わったときに gutter へ伝える effect。
export const setOriginalEffect = StateEffect.define<string>();

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

  const markerField = StateField.define<RangeSet<GutterMarker>>({
    create: (state) => computeMarkers(state.field(originalField), state.doc),
    update(value, tr) {
      if (tr.docChanged || tr.effects.some((effect) => effect.is(setOriginalEffect))) {
        return computeMarkers(tr.state.field(originalField), tr.newDoc);
      }
      return value;
    },
  });

  const changeGutter = gutter({
    class: "cm-change-gutter",
    markers: (view) => view.state.field(markerField),
  });

  return [originalField, markerField, changeGutter];
}
