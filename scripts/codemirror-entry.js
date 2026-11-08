// What the page uses from CodeMirror 6; scripts/codemirror.mjs bundles it into web/supstack.html as window.CM.
export { EditorState, EditorSelection, StateField, StateEffect, RangeSetBuilder, Prec, Compartment, Transaction, Annotation } from "@codemirror/state";
export { EditorView, Decoration, WidgetType, ViewPlugin, keymap, drawSelection, placeholder } from "@codemirror/view";
export { history, historyKeymap, defaultKeymap, undo, redo, moveLineUp, moveLineDown } from "@codemirror/commands";
export { syntaxTree, ensureSyntaxTree, syntaxHighlighting, HighlightStyle, Language, LanguageSupport, defineLanguageFacet } from "@codemirror/language";
// the Markdown parser itself, without @codemirror/lang-markdown (it pulls in the HTML, CSS and JavaScript languages)
export { parser as markdownParser, GFM } from "@lezer/markdown";
export { tags } from "@lezer/highlight";
