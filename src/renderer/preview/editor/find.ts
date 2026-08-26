import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface EditorFindMatch {
  from: number;
  to: number;
}

interface EditorFindState {
  activeIndex: number;
  matches: readonly EditorFindMatch[];
}

export const setEditorFindEffect = StateEffect.define<EditorFindState>();

const matchDecoration = Decoration.mark({ class: "cm-find-match" });
const activeMatchDecoration = Decoration.mark({ class: "cm-find-match active" });

/** CodeMirror の本文へ、現在の検索結果と選択中の 1 件を描画する。 */
export function editorFind(): Extension {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setEditorFindEffect)) {
          return Decoration.set(
            effect.value.matches.map((match, index) =>
              (index === effect.value.activeIndex ? activeMatchDecoration : matchDecoration).range(
                match.from,
                match.to,
              ),
            ),
          );
        }
      }
      return transaction.docChanged ? value.map(transaction.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** 閲覧モードのファイル内検索と同じ、大文字小文字を無視した重複なしの部分一致。 */
export function findEditorMatches(doc: Text, query: string): EditorFindMatch[] {
  if (query.length === 0) {
    return [];
  }

  const text = doc.toString().toLowerCase();
  const loweredQuery = query.toLowerCase();
  const matches: EditorFindMatch[] = [];
  let from = 0;
  while (from <= text.length - loweredQuery.length) {
    const found = text.indexOf(loweredQuery, from);
    if (found < 0) {
      break;
    }
    matches.push({ from: found, to: found + loweredQuery.length });
    from = found + loweredQuery.length;
  }
  return matches;
}
