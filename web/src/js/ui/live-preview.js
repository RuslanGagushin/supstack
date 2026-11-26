import { hueOf } from "../core/util.js";
import { CODE_RE, extractLinkpath } from "../core/frontmatter.js";
import { BOX_LINE_RE, taskState } from "../core/org.js";
import { findTables, tableSpans } from "../core/tables.js";
import { editor, graph } from "../services/state.js";
import { resolveFileLink, resolveLink } from "../services/vault.js";
import { $, $$, h, isMod } from "./dom.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { createCard } from "./actions.js";
import { openTagView, setTarget } from "./board.js";
import { edDom, editorTextarea, openEditor } from "./editor.js";
import { liveCellOpen, liveTableAt, liveTableButtons, liveTableOp, tableMenu } from "./table-editor.js";
import { tableCellDown, tableCellDrag, tableHover, tableHoverEnd, tableSelMenuAt } from "./table-select.js";
import { updateEdToolbar } from "./editor-toolbar.js";
import { openAttachment } from "./files.js";
import { taskBox } from "./task-icons.js";

/* ---------- Live preview: the note body is one CodeMirror document, and away from the caret its Markdown
   renders in place. Formatting marks (**, *, ~~, ==, `, [[ ]], [](…), #, >) hide unless the caret is in that piece of text; headings,
   links, tags, highlights, task boxes, bullets and priorities show as they read. Callouts, code blocks and embeds render as blocks that turn
   back into Markdown when the caret goes in; tables stay rendered and are edited a cell at a time. editor.live = { path, body } holds the
   body the editor opened with; liveText() is what it holds now. */
export function liveTa() { return $(".sn-editor-text.is-live"); }
export function liveText() { const ta = liveTa(); return ta ? ta.value : editor.live?.body ?? ""; }
/** (Re)build the live editor, or give it the body after a change from outside. */
export function renderLive() {
  const L = editor.live, box = $("#editor .sn-live");
  if (!box || !L) return;
  editor.cell = null;
  const ta = liveTa();
  if (ta && box.contains(ta)) { if (ta.value !== L.body) ta.value = L.body; return; }
  box.replaceChildren(edDom(editorTextarea(L.body, true)));
}
/** Put the caret at a body offset, scrolled into view. */
export function liveActivate(off) {
  const ta = liveTa();
  if (!ta) return null;
  off = Math.max(0, Math.min(off, ta.value.length));
  ta.focus({ preventScroll: true });
  ta.cmView.dispatch({ selection: { anchor: off }, effects: CM.EditorView.scrollIntoView(off, { y: "center" }) });
  updateEdToolbar();
  return ta;
}
export function liveActivateEnd() { return liveActivate(liveText().length); }
/** A line typed at `pos` would be part of a table when it is the table's first or last line, or an empty line right against it:
 *  a table only ends at a blank line, and a line right above one is not a table any more. What has to go around the text there
 *  ({ before, after }), else null. */
function lpTableEdge(doc, pos) {
  const l = doc.lineAt(pos);
  if (![l.number - 1, l.number, l.number + 1].some((n) => n >= 1 && n <= doc.lines && doc.line(n).text.includes("|"))) return null;
  for (const tb of findTables(doc.toString())) {
    if (pos === tb.to) return { before: "\n\n", after: "" };
    if (pos === tb.from) return { before: "", after: "\n\n" };
    if (l.text.trim()) continue;
    if (l.from === tb.to + 1) return { before: "\n", after: "" };
    if (l.to === tb.from - 1) return { before: "", after: "\n" };
  }
  return null;
}
/** The caret at `pos`; where text would go into a table (lpTableEdge), on a new line of its own there, above or below the table. */
export function liveOpenAt(pos) {
  const ta = liveTa(), view = ta?.cmView;
  if (!view) return null;
  const edge = lpTableEdge(view.state.doc, Math.max(0, Math.min(pos, view.state.doc.length)));
  if (!edge) return liveActivate(pos);
  ta.focus({ preventScroll: true }); // first: CodeMirror reads the browser's caret when it gets the focus
  view.dispatch({ changes: { from: pos, insert: edge.before + edge.after }, selection: { anchor: pos + edge.before.length }, scrollIntoView: true, userEvent: "input.table" });
  updateEdToolbar();
  return ta;
}
/** A click in the note's empty space around the body: above it (under the title) puts the caret at the start, below it at the end,
 *  on a line of its own when a table begins or ends the note (liveOpenAt). Before, a note that was only a table had nowhere to click. */
export function livePageDown(e) {
  const box = $("#editor .sn-live"), view = liveTa()?.cmView;
  if (e.button !== 0 || isMod(e) || e.shiftKey || !box || !view) return;
  if (!(e.target === e.currentTarget || e.target === box || e.target.matches(".cm-editor, .cm-scroller"))) return;
  const r = view.contentDOM.getBoundingClientRect();
  if (e.clientY >= r.top && e.clientY <= r.bottom) return; // beside the lines: CodeMirror's
  if (e.clientY < r.top) {
    // only from the gap between the title (or the properties) and the body, not from beside them
    let prev = box.previousElementSibling;
    while (prev && !prev.getBoundingClientRect().height) prev = prev.previousElementSibling;
    if (prev && e.clientY < prev.getBoundingClientRect().bottom) return;
  }
  e.preventDefault();
  liveOpenAt(e.clientY < r.top ? 0 : view.state.doc.length);
}
/** Text typed or pasted against a table goes on a line of its own (lpTableEdge) rather than into the table. Not while an IME composes:
 *  CodeMirror keeps the composed text where the browser put it (a tap first puts the caret on its own line, livePageDown). */
const lpTableGuard = CM.EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("input.type.compose") || !(tr.isUserEvent("input.type") || tr.isUserEvent("input.paste"))) return tr;
  const ch = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => ch.push({ fromA, toA, text: ins.toString() }));
  if (ch.length !== 1 || ch[0].fromA !== ch[0].toA || ch[0].text.startsWith("\n")) return tr;
  const { fromA: pos, text } = ch[0], edge = lpTableEdge(tr.startState.doc, pos);
  if (!edge) return tr;
  return { changes: { from: pos, insert: edge.before + text + edge.after }, selection: { anchor: pos + edge.before.length + text.length }, scrollIntoView: true, userEvent: tr.annotation(CM.Transaction.userEvent) };
});
function liveTaskCount(text) {
  return (text.replace(CODE_RE, (m) => m.replace(/\[/g, "\u0001")).match(new RegExp(BOX_LINE_RE.source, "gm")) || []).length;
}
/** Where a click in rendered Markdown falls in its source: match the rendered text before the point against the source. */
function liveClickOffset(el, e, src) {
  let node, offset;
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); node = r?.startContainer; offset = r?.startOffset; }
  else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); node = p?.offsetNode; offset = p?.offset; }
  if (!node || !el.contains(node)) return src.length;
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setEnd(node, offset); } catch { return src.length; }
  const txt = r.toString();
  let j = 0;
  for (const ch of txt) {
    if (/\s/.test(ch)) continue;
    const k = src.indexOf(ch, j);
    if (k >= 0 && k - j < 40) j = k + 1;
  }
  if (/\s$/.test(txt)) while (j < src.length && /[ \t]/.test(src[j])) j++;
  return j;
}
export function wireLive(box, path) {
  wireRendered(box, path);
  // a task box clicked inside a rendered block (a callout) is numbered against the whole note before setTaskState runs
  const renumber = (e) => {
    const cb = e.target.closest(".task-box[data-task]"), w = cb?.closest(".lp-block"), view = liveTa()?.cmView;
    if (!w || !view) return;
    const local = $$(".task-box[data-task]", w).indexOf(cb);
    cb.dataset.task = String(liveTaskCount(view.state.doc.sliceString(0, view.posAtDOM(w))) + local);
  };
  box.addEventListener("click", renumber, true);
  box.addEventListener("contextmenu", renumber, true);
}

/* the decorations: the caret "touches" a piece of text when the editor has focus and a selection range meets it */
const lpFocus = CM.StateEffect.define();
/** Embedded notes changed: their widgets are drawn again (refreshLiveEmbeds). */
const lpEmbeds = CM.StateEffect.define();
let embedVersion = 0;
export function refreshLiveEmbeds() {
  const view = liveTa()?.cmView;
  if (!view) return;
  embedVersion++;
  view.dispatch({ effects: lpEmbeds.of(embedVersion) });
}
const lpFocused = CM.StateField.define({ create: () => false, update: (v, tr) => { for (const e of tr.effects) if (e.is(lpFocus)) v = e.value; return v; } });
const lpNear = (state, from, to) => state.field(lpFocused) && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
const lpNearLine = (state, pos) => { const l = state.doc.lineAt(pos); return lpNear(state, l.from, l.to); };
class LpText extends CM.WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls; }
  eq(o) { return o.text === this.text && o.cls === this.cls; }
  toDOM() { return h("span", { cls: this.cls, text: this.text }); }
}
class LpTags extends CM.WidgetType {
  constructor(tags) { super(); this.tags = tags; }
  eq(o) { return o.tags.join(":") === this.tags.join(":"); }
  toDOM() { return h("span", { cls: "tags org-tags" }, this.tags.map((x) => h("span", { cls: "sn-chip is-s hue-" + hueOf(x), text: x }))); }
}
/** A #tag away from the caret: the reading view's chip (the grey plate, a dot in its hue, no #), so a tag looks the same in
 *  both views. A click opens the tag's notes (the mousedown handler below), as in the reading view. */
class LpTag extends CM.WidgetType {
  constructor(tag) { super(); this.tag = tag; }
  eq(o) { return o.tag === this.tag; }
  toDOM() { return h("a", { cls: "tag cm-sn-tag hue-" + hueOf(this.tag), text: this.tag, dataset: { tag: this.tag } }); }
  ignoreEvent() { return false; }
}
class LpRule extends CM.WidgetType { eq() { return true; } toDOM() { return h("hr", { cls: "lp-hr" }); } }
/** The indentation of a nested list line, as wide as the reading view makes it: each list item it sits in moves it right by that
 *  item's lead (a task's box and gap, --box-lead; a bullet's or a number's 1.6em, base.css), so a line stays put between the views. */
class LpIndent extends CM.WidgetType {
  constructor(path) { super(); this.path = path; }
  eq(o) { return o.path === this.path; }
  toDOM() { return lpIndentEl(this.path); }
}
const lpIndentEl = (path) => {
  const tasks = [...path].filter((k) => k === "t").length;
  return h("span", { cls: "cm-sn-indent", style: `--tasks: ${tasks}; --items: ${path.length - tasks}` });
};
const LP_TASK_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\](?=[ \t]|$)/;
/** The list items around position `pos`, outermost first, as one letter each: "t" a box, "b" any other item. */
function lpListPath(state, pos) {
  let path = "";
  for (let n = CM.syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === "ListItem") path = (LP_TASK_LINE.test(state.doc.lineAt(n.from).text) ? "t" : "b") + path;
  return path;
}
/** Tick or untick the box on the line at `pos`: `pick(current)` gives the new box character (undefined leaves it). */
function lpSetState(view, pos, pick) {
  const l = view.state.doc.lineAt(pos);
  const m = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(l.text);
  if (!m) return;
  const to = pick(m[2]);
  if (to === undefined) return;
  // a box in a note is a checklist's: only its character changes
  view.dispatch({ changes: { from: l.from + m[1].length, to: l.from + m[1].length + 1, insert: to }, userEvent: "input.task" });
}
class LpBox extends CM.WidgetType {
  constructor(ch) { super(); this.ch = ch; }
  eq(o) { return o.ch === this.ch; }
  toDOM(view) {
    const el = taskBox(this.ch);
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => { e.preventDefault(); lpSetState(view, view.posAtDOM(el), (cur) => (taskState(cur)?.open ? "x" : " ")); });
    return el;
  }
  ignoreEvent() { return true; }
}
/** Rendered Markdown in the document: an embed inline, or a whole block (a callout, a code block); a click opens its source at that spot. */
class LpRendered extends CM.WidgetType {
  // an embed's widget is also drawn again when the notes it shows change (embedVersion)
  constructor(text, block) { super(); this.text = text; this.block = block; this.version = text.startsWith("![[") ? embedVersion : 0; }
  eq(o) { return o.text === this.text && o.block === this.block && o.version === this.version; }
  toDOM(view) {
    const el = h(this.block ? "div" : "span", { cls: this.block ? "lp-block" : "lp-inline" });
    renderMarkdown(this.text, editor.path, { into: el, pdf: true });
    if (!this.block && el.childElementCount === 1 && el.firstElementChild.tagName === "P") el.firstElementChild.replaceWith(...el.firstElementChild.childNodes);
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("a, input, button, summary, .code-head, .sn-pdf, .callout.is-collapsible > .callout-title, .org-fold, [data-org-act]")) return;
      e.preventDefault();
      const from = view.posAtDOM(el);
      view.focus();
      view.dispatch({ selection: { anchor: from + liveClickOffset(el, e, this.text) } });
    });
    return el;
  }
  ignoreEvent() { return true; }
}
class LpTable extends CM.WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() {
    const el = h("div", { cls: "lp-block lp-table" });
    lpTableFill(el, this.text);
    // a cell is edited on mousedown, so an open cell editor never loses the focus to the next cell
    el.addEventListener("mousedown", (e) => {
      const cell = e.button === 0 && !e.target.closest("a, input, button, .sn-cell-edit") && e.target.closest("td, th"), at = cell && liveTableAt(cell);
      if (!at || tableCellDown(e, cell, at)) return;
      e.preventDefault();
      const src = at.tb.lines[at.row ? at.row + 1 : 0], sp = tableSpans(src)[at.col] || [0, 0];
      liveCellOpen(at.tb.from, at.row, at.col, { caret: liveClickOffset(cell, e, src.slice(...sp)) });
      tableCellDrag(e, at); // a drag on to other cells selects them
    });
    el.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") tableHover(e, el.querySelector(".sn-table-host")); });
    el.addEventListener("pointerleave", () => tableHoverEnd(el.querySelector(".sn-table-host")));
    el.addEventListener("contextmenu", (e) => {
      const cell = e.target.closest("td, th"), at = cell && liveTableAt(cell);
      if (at && !tableSelMenuAt(e, at)) tableMenu((op) => liveTableOp({ from: at.tb.from, row: at.row, col: at.col }, op, { edit: /^(row|col)(Above|Below|Left|Right)$/.test(op) }), at.row).showAtEvent(e);
    });
    return el;
  }
  // while a cell is being edited the table keeps its DOM: the edit is already on screen
  updateDOM(el) { if (!el.contains(editor.cell?.el)) lpTableFill(el, this.text); return true; }
  ignoreEvent() { return true; }
}
export function lpTableFill(el, text) { el.replaceChildren(); renderMarkdown(text, editor.path, { into: el }); liveTableButtons(el); }

/** Inline decorations for the visible lines. */
function lpInline(view) {
  const { state } = view, out = [], skip = [];
  const add = (from, to, deco) => { if (to >= from) out.push(deco.range(from, to)); };
  const hide = (from, to) => { if (to > from) add(from, to, CM.Decoration.replace({})); };
  const mark = (from, to, cls, attributes) => { if (to > from) add(from, to, CM.Decoration.mark({ class: cls, attributes })); };
  const line = (pos, cls, attributes) => out.push(CM.Decoration.line({ class: cls, attributes }).range(state.doc.lineAt(pos).from));
  const fmt = (from, to, near) => (near ? mark(from, to, "cm-sn-fmt") : hide(from, to));
  const tree = CM.syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (n) => {
      const name = n.name, near = () => lpNear(state, n.from, n.to);
      if (/^(FencedCode|CodeBlock|Table|HTMLBlock|CommentBlock)$/.test(name)) { skip.push([n.from, n.to]); return false; }
      if (name === "Blockquote" && /^\s*>\s*\[!/.test(state.doc.lineAt(n.from).text)) { skip.push([n.from, n.to]); return false; }
      const hm = /^ATXHeading(\d)$/.exec(name);
      if (hm) {
        // a heading with no blank line under it keeps the reading view's gap there itself; the note's first line has none above (writing.css)
        const hl = state.doc.lineAt(n.from), next = hl.number < state.doc.lines ? state.doc.line(hl.number + 1).text : "";
        line(n.from, `cm-sn-h cm-sn-h${hm[1]}` + (next.trim() ? " cm-sn-h-tight" : "") + (hl.number === 1 ? " cm-sn-h-first" : ""));
        const m = n.node.getChild("HeaderMark");
        if (m && !lpNearLine(state, n.from)) hide(m.from, Math.min(n.to, m.to + 1));
        return;
      }
      if (name === "Emphasis" || name === "StrongEmphasis" || name === "Strikethrough") {
        mark(n.from, n.to, { Emphasis: "cm-sn-em", StrongEmphasis: "cm-sn-strong", Strikethrough: "cm-sn-strike" }[name]);
        const nr = near();
        for (const c of n.node.getChildren(name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark")) fmt(c.from, c.to, nr);
        return;
      }
      if (name === "InlineCode") {
        skip.push([n.from, n.to]);
        const nr = near(), marks = n.node.getChildren("CodeMark");
        mark(marks[0]?.to ?? n.from, marks.at(-1)?.from ?? n.to, "cm-sn-code");
        for (const c of marks) fmt(c.from, c.to, nr);
        return false;
      }
      if (name === "Link" || name === "Image") {
        const marks = n.node.getChildren("LinkMark"), url = n.node.getChild("URL");
        // the parser reads the inner [x] of a [[wikilink]] as a link: those, and links without a target, are left to the wikilink pass
        if (name === "Link" && (!url || marks.length < 2 || state.sliceDoc(n.from - 1, n.from) === "[")) return false;
        skip.push([n.from, n.to]);
        const nr = near();
        if (name === "Image") { if (!nr) add(n.from, n.to, CM.Decoration.replace({ widget: new LpRendered(state.sliceDoc(n.from, n.to), false) })); return false; }
        const textFrom = marks[0].to, textTo = marks[1].from;
        if (nr) { mark(n.from, textFrom, "cm-sn-fmt"); mark(textTo, n.to, "cm-sn-fmt"); return false; }
        hide(n.from, textFrom); hide(textTo, n.to);
        mark(textFrom, textTo, "cm-sn-link", { "data-url": url ? state.sliceDoc(url.from, url.to) : "" });
        return false;
      }
      if (name === "URL" && n.node.parent?.name !== "Link") { mark(n.from, n.to, "cm-sn-link", { "data-url": state.sliceDoc(n.from, n.to) }); return; }
      if (name === "ListMark") {
        const item = n.node.parent, ln = state.doc.lineAt(n.from), lineTo = ln.to, path = lpListPath(state, n.from);
        // a nested item's indentation is drawn as wide as the reading view's (LpIndent); the caret in it brings the spaces back
        if (n.from > ln.from && /^[ \t]+$/.test(state.sliceDoc(ln.from, n.from)) && !lpNear(state, ln.from, n.from)) add(ln.from, n.from, CM.Decoration.replace({ widget: new LpIndent(path.slice(0, -1)) }));
        // a long item wraps under its own text, past its indentation and its box or bullet, as in the reading view (writing.css)
        const tasks = [...path].filter((k) => k === "t").length;
        line(n.from, "cm-sn-li", { style: `--tasks: ${tasks}; --items: ${path.length - tasks}` });
        const bm = /^([ \t]+)\[([ xX])\](?=[ \t]|$)/.exec(state.sliceDoc(n.to, Math.min(lineTo, n.to + 12)));
        const st = bm && taskState(bm[2]);
        if (st) {
          // the line carries its box as data-task, the attribute themes and snippets for Obsidian use (" ", "x")
          line(n.from, "cm-sn-taskline", { "data-task": st.ch });
          const boxTo = n.to + bm[0].length;
          if (st.id !== "todo" && boxTo < lineTo) mark(boxTo, lineTo, "cm-sn-task s-" + st.id);
          if (!lpNear(state, n.from, boxTo)) add(n.from, boxTo, CM.Decoration.replace({ widget: new LpBox(st.ch) }));
          return;
        }
        // a bullet or a number and the space after it take the reading view's 1.6em (writing.css), so the item's text starts where it does there
        const sp = state.sliceDoc(n.to, n.to + 1) === " " ? 1 : 0;
        if (lpNear(state, n.from, n.to + sp)) { if (item?.parent?.name !== "BulletList") mark(n.from, n.to, "cm-sn-olmark"); }
        else add(n.from, n.to + sp, CM.Decoration.replace({ widget: item?.parent?.name === "BulletList" ? new LpText("•", "cm-sn-bullet cm-sn-marker") : new LpText(state.sliceDoc(n.from, n.to), "cm-sn-olmark cm-sn-marker") }));
        return;
      }
      if (name === "HorizontalRule") { if (!lpNearLine(state, n.from)) add(n.from, n.to, CM.Decoration.replace({ widget: new LpRule() })); return; }
      if (name === "Blockquote") { for (let p = n.from; p <= n.to; ) { const l = state.doc.lineAt(p); line(l.from, "cm-sn-quote"); p = l.to + 1; } return; }
      if (name === "QuoteMark") { if (!lpNearLine(state, n.from)) hide(n.from, Math.min(state.doc.lineAt(n.from).to, n.to + (state.sliceDoc(n.to, n.to + 1) === " " ? 1 : 0))); return; }
      if (name === "Escape") { if (!near()) hide(n.from, n.from + 1); }
    } });
  }
  // what the Markdown parser doesn't know: [[links]], ![[embeds]], ==highlights==, #tags and priorities, outside code and links
  const inSkip = (a, b) => skip.some(([s, e]) => a < e && b > s);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const l = state.doc.lineAt(pos), text = l.text, at = (i) => l.from + i;
      pos = l.to + 1;
      // a blank line between blocks is the reading view's gap there, not a line of text: a paragraph's 1em, or under a heading its .5em
      if (!text.trim() && tree.resolveInner(l.from, 1).name === "Document") {
        const hm = l.number > 1 && /^(#{1,6})[ \t]/.exec(state.doc.line(l.number - 1).text);
        line(l.from, "cm-sn-gap" + (hm ? " cm-sn-gap-h" + hm[1].length : ""));
        continue;
      }
      for (const m of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
        const a = at(m.index), b = a + m[0].length;
        if (inSkip(a, b)) continue;
        skip.push([a, b]);
        const nr = lpNear(state, a, b);
        if (m[1]) { if (!nr) add(a, b, CM.Decoration.replace({ widget: new LpRendered(m[0], false) })); continue; }
        const [target, alias] = m[2].split("|"), lp = extractLinkpath(`[[${target}]]`);
        const cls = "cm-sn-link cm-sn-wikilink" + (resolveLink(lp, editor.path) || resolveFileLink(lp, editor.path) ? "" : " is-unresolved");
        const tFrom = alias != null ? a + 2 + target.length + 1 : a + 2;
        if (nr) { mark(a, a + 2, "cm-sn-fmt"); mark(b - 2, b, "cm-sn-fmt"); mark(a + 2, b - 2, cls, { "data-href": target }); continue; }
        hide(a, tFrom); hide(b - 2, b);
        mark(tFrom, b - 2, cls, { "data-href": target });
      }
      for (const m of text.matchAll(/==([^=\n]+)==/g)) {
        const a = at(m.index), b = a + m[0].length;
        if (inSkip(a, b)) continue;
        const nr = lpNear(state, a, b);
        fmt(a, a + 2, nr); fmt(b - 2, b, nr); mark(a + 2, b - 2, "cm-sn-mark");
      }
      for (const m of text.matchAll(/(^|[\s,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) {
        const a = at(m.index + m[1].length), b = at(m.index + m[0].length);
        if (inSkip(a, b) || /^#+\s/.test(text)) continue;
        // with the caret in it the tag is its Markdown (#travel); away from it, the reading view's chip
        if (lpNear(state, a, b)) mark(a, b, "cm-sn-tag", { "data-tag": m[2] });
        else add(a, b, CM.Decoration.replace({ widget: new LpTag(m[2]) }));
      }
      // a list item's line that is not its first (a note under a box, a bullet's second paragraph) starts where the item's text does,
      // past every item it sits in, and wraps there too; with the caret on it, its indentation is plain spaces again
      const ind = /^[ \t]*/.exec(text)[0].length;
      if (ind && text.trim() && !/^[ \t]*(?:[-*+]|\d+[.)])[ \t]/.test(text) && !inSkip(l.from, l.to)) {
        const path = lpListPath(state, l.from + ind);
        if (path) {
          const tasks = [...path].filter((k) => k === "t").length;
          line(l.from, "cm-sn-li", { style: `--tasks: ${tasks}; --items: ${path.length - tasks}` });
          if (!lpNearLine(state, l.from)) add(l.from, l.from + ind, CM.Decoration.replace({ widget: new LpIndent(path) }));
        }
      }
      // Org tags at the end of a heading or list item (:work:urgent:) show as tag pills away from the caret
      const tm = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s).*?(\s):((?:[\p{L}\p{N}_@#%-]+:)+)\s*$/u.exec(text);
      if (tm) {
        const b = l.to, a = b - (text.length - text.lastIndexOf(":" + tm[2]));
        if (!inSkip(a, b)) { if (lpNearLine(state, a)) mark(a, b, "cm-sn-fmt"); else add(a, b, CM.Decoration.replace({ widget: new LpTags(tm[2].split(":").filter(Boolean)) })); }
      }
    }
  }
  return CM.Decoration.set(out, true);
}
const lpInlinePlugin = CM.ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = lpInline(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(lpFocus) || e.is(lpEmbeds)))) this.decorations = lpInline(u.view); }
}, { decorations: (v) => v.decorations });
/** Block decorations (a StateField: they replace whole lines): tables always, callouts and code blocks away from the caret. */
function lpBlocks(state) {
  const out = [], tree = CM.ensureSyntaxTree(state, state.doc.length, 200) || CM.syntaxTree(state);
  const block = (from, to, widget) => out.push(CM.Decoration.replace({ widget, block: true }).range(state.doc.lineAt(from).from, state.doc.lineAt(to).to));
  tree.iterate({ enter: (n) => {
    if (n.name === "Table") { block(n.from, n.to, new LpTable(state.sliceDoc(state.doc.lineAt(n.from).from, state.doc.lineAt(n.to).to))); return false; }
    if (n.name === "FencedCode" || (n.name === "Blockquote" && /^\s*>\s*\[!/.test(state.doc.lineAt(n.from).text))) {
      if (!lpNear(state, n.from, n.to)) block(n.from, n.to, new LpRendered(state.sliceDoc(state.doc.lineAt(n.from).from, state.doc.lineAt(n.to).to), true));
      return false;
    }
    return /^(Document|BulletList|OrderedList|ListItem|Blockquote)$/.test(n.name);
  } });
  return CM.Decoration.set(out, true);
}
const lpBlockField = CM.StateField.define({
  create: lpBlocks,
  update: (deco, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(lpFocus)) ? lpBlocks(tr.state) : deco),
  provide: (f) => CM.EditorView.decorations.from(f),
});
/** Open what a rendered link points at: a note, an attachment, a tag view or a web page. */
function lpOpenLink(el, e) {
  if (el.dataset.tag) { openTagView(el.dataset.tag); return; }
  const url = el.dataset.url, href = el.dataset.href ?? (url && !/^[a-z][\w+.-]*:/i.test(url) ? decodeURIComponent(url.replace(/\.md(#.*)?$/i, "")) : null);
  if (href == null) { if (url) window.open(url, "_blank", "noopener"); return; }
  const lp = extractLinkpath(`[[${href}]]`), p = resolveLink(lp, editor.path), file = p ? null : resolveFileLink(lp, editor.path);
  if (file) openAttachment(file);
  else if (p) { if (isMod(e) || !graph.has(p)) openEditor(p); else setTarget(p); }
  else createCard(lp || el.textContent, null, "", undefined, { open: true });
}
/** Table cells, entered with the arrows from the line above or below the table. */
function lpTableArrow(e, view) {
  if (e.altKey || e.shiftKey || isMod(e) || !/^Arrow(Up|Down)$/.test(e.key)) return false;
  const { state } = view, head = state.selection.main.head, line = state.doc.lineAt(head), down = e.key === "ArrowDown";
  const next = down ? line.number < state.doc.lines && state.doc.line(line.number + 1) : line.number > 1 && state.doc.line(line.number - 1);
  if (!next) return false;
  const tb = findTables(state.doc.toString()).find((t) => (down ? t.from === next.from : t.to === next.to));
  if (!tb) return false;
  const rows = tb.lines.length - 1;
  e.preventDefault();
  return !!liveCellOpen(tb.from, down ? 0 : rows - 1, 0);
}
export function livePreviewExtensions() {
  return [
    lpFocused,
    CM.EditorView.focusChangeEffect.of((state, focusing) => lpFocus.of(focusing)),
    lpInlinePlugin,
    lpBlockField,
    lpTableGuard,
    CM.EditorView.domEventHandlers({
      mousedown: (e, view) => {
        if (e.button !== 0) return false;
        const el = e.target.closest(".cm-sn-link, .cm-sn-tag");
        if (el) { e.preventDefault(); lpOpenLink(el, e); return true; }
        // a click on the empty line under (or over) a table: a line of its own, so what is typed next isn't a row of the table
        const pos = !isMod(e) && !e.shiftKey && e.detail === 1 ? view.posAtCoords({ x: e.clientX, y: e.clientY }) : null;
        if (pos == null || view.state.doc.lineAt(pos).text.trim() || !lpTableEdge(view.state.doc, pos)) return false;
        e.preventDefault();
        liveOpenAt(pos);
        return true;
      },
      keydown: (e, view) => lpTableArrow(e, view),
    }),
  ];
}
