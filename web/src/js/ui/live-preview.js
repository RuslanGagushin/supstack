import { CODE_RE, extractLinkpath } from "../core/frontmatter.js";
import { orgLine, orgSetState, TASK_LINE_RE, taskState } from "../core/org.js";
import { findTables, tableSpans } from "../core/tables.js";
import { editor, graph, vault } from "../services/state.js";
import { resolveFileLink, resolveLink } from "../services/vault.js";
import { $, $$, h, isMod } from "./dom.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { createCard } from "./actions.js";
import { openTagView, setTarget } from "./board.js";
import { edDom, editorTextarea, openEditor } from "./editor.js";
import { liveCellOpen, liveTableAt, liveTableButtons, liveTableOp, tableMenu } from "./table-editor.js";
import { updateEdToolbar } from "./editor-toolbar.js";
import { ORG_DECOR_RE } from "./org-editing.js";
import { openAttachment } from "./files.js";
import { orgPickStateChar } from "./org-commands.js";
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
function liveTaskCount(text) {
  return (text.replace(CODE_RE, (m) => m.replace(/\[/g, "\u0001")).match(new RegExp(TASK_LINE_RE.source, "gm")) || []).length;
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
  toDOM() { return h("span", { cls: "tags org-tags" }, this.tags.map((x) => h("span", { cls: "tag", text: x }))); }
}
class LpRule extends CM.WidgetType { eq() { return true; } toDOM() { return h("hr", { cls: "lp-hr" }); } }
/** Set the state of the task on the line at `pos`: `pick(current)` gives the new box character (undefined leaves it). */
function lpSetState(view, pos, pick) {
  const doc = view.state.doc, l = doc.lineAt(pos), nx = l.number < doc.lines ? doc.line(l.number + 1) : null;
  const m = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX\/<>-])\]/.exec(l.text);
  if (!m) return;
  const to = pick(m[2]);
  if (to === undefined) return;
  if (orgLine(l.text)?.box == null) { view.dispatch({ changes: { from: l.from + m[1].length, to: l.from + m[1].length + 1, insert: to }, userEvent: "input.task" }); return; }
  // CLOSED: and repeaters live on the planning line under the task, so the change covers both lines
  const before = nx ? l.text + "\n" + nx.text : l.text, L = before.split("\n");
  if (!orgSetState(L, 0, to)) return;
  const after = L.join("\n");
  let a = 0, b = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  view.dispatch({ changes: { from: l.from + a, to: l.from + before.length - b, insert: after.slice(a, after.length - b) }, userEvent: "input.task" });
}
class LpBox extends CM.WidgetType {
  constructor(ch) { super(); this.ch = ch; }
  eq(o) { return o.ch === this.ch; }
  toDOM(view) {
    const el = taskBox(this.ch, {}, { square: true });
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => { e.preventDefault(); lpSetState(view, view.posAtDOM(el), (cur) => (taskState(cur)?.open ? "x" : " ")); });
    el.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(el), ch = await orgPickStateChar(this.ch);
      if (ch !== undefined) lpSetState(view, pos, () => ch);
    });
    return el;
  }
  ignoreEvent() { return true; }
}
/** Rendered Markdown in the document: an embed inline, or a whole block (a callout, a code block); a click opens its source at that spot. */
class LpRendered extends CM.WidgetType {
  constructor(text, block) { super(); this.text = text; this.block = block; }
  eq(o) { return o.text === this.text && o.block === this.block; }
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
      if (!at) return;
      e.preventDefault();
      const src = at.tb.lines[at.row ? at.row + 1 : 0], sp = tableSpans(src)[at.col] || [0, 0];
      liveCellOpen(at.tb.from, at.row, at.col, { caret: liveClickOffset(cell, e, src.slice(...sp)) });
    });
    el.addEventListener("contextmenu", (e) => {
      const cell = e.target.closest("td, th"), at = cell && liveTableAt(cell);
      if (at) tableMenu((op) => liveTableOp({ from: at.tb.from, row: at.row, col: at.col }, op, { edit: /^(row|col)(Above|Below|Left|Right)$/.test(op) }), at.row).showAtEvent(e);
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
        line(n.from, `cm-sn-h cm-sn-h${hm[1]}`);
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
        const item = n.node.parent, lineTo = state.doc.lineAt(n.from).to;
        const bm = /^([ \t]+)\[([ xX\/<>-])\](?=[ \t]|$)/.exec(state.sliceDoc(n.to, Math.min(lineTo, n.to + 12)));
        const st = bm && taskState(bm[2]);
        if (st) {
          // the line carries its state as data-task, the attribute themes and snippets for Obsidian use ("x", "/", "<"…)
          line(n.from, "cm-sn-taskline", { "data-task": st.ch });
          const boxTo = n.to + bm[0].length;
          if (st.id !== "todo" && boxTo < lineTo) mark(boxTo, lineTo, "cm-sn-task s-" + st.id);
          if (!lpNear(state, n.from, boxTo)) add(n.from, boxTo, CM.Decoration.replace({ widget: new LpBox(st.ch) }));
          return;
        }
        if (item?.parent?.name === "BulletList") { if (!lpNear(state, n.from, n.to)) add(n.from, n.to, CM.Decoration.replace({ widget: new LpText("•", "cm-sn-bullet") })); }
        else mark(n.from, n.to, "cm-sn-olmark");
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
        if (!inSkip(a, b) && !/^#+\s/.test(text)) mark(a, b, "cm-sn-tag", { "data-tag": m[2] });
      }
      const om = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX\/<>-]\][ \t]+)\[#([A-Z0-9])\](?=\s|$)/.exec(text);
      if (om) mark(at(om[1].length), at(om[1].length + 4), `pri ${om[2]}`);
      // Org tags at the end of a heading or list item (:work:urgent:) show as tag pills away from the caret
      const tm = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s).*?(\s):((?:[\p{L}\p{N}_@#%-]+:)+)\s*$/u.exec(text);
      if (tm) {
        const b = l.to, a = b - (text.length - text.lastIndexOf(":" + tm[2]));
        if (!inSkip(a, b)) { if (lpNearLine(state, a)) mark(a, b, "cm-sn-fmt"); else add(a, b, CM.Decoration.replace({ widget: new LpTags(tm[2].split(":").filter(Boolean)) })); }
      }
      // SCHEDULED: / DEADLINE: / CLOSED: read as pills like the priorities, and dates as pills without their < > or [ ]
      // (the colon and the brackets come back where the caret is, so the text stays plain Org)
      for (const m of text.matchAll(new RegExp(ORG_DECOR_RE.source, "g"))) {
        const a = at(m.index), b = a + m[0].length;
        if (inSkip(a, b)) continue;
        const nr = lpNear(state, a, b);
        if (m[1]) { mark(a, b - 1, "org-plan k-" + m[1].slice(0, -1).toLowerCase() + (nr ? " is-near" : "")); fmt(b - 1, b, nr); continue; }
        mark(a, b, "org-ts" + (m[3] ? " is-inactive" : ""));
        fmt(a, a + 1, nr); fmt(b - 1, b, nr);
        const mid = m[0].indexOf(">--<");
        if (mid > 0) { fmt(a + mid, a + mid + 1, nr); fmt(a + mid + 3, a + mid + 4, nr); }
      }
    }
  }
  return CM.Decoration.set(out, true);
}
const lpInlinePlugin = CM.ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = lpInline(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(lpFocus)))) this.decorations = lpInline(u.view); }
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
    CM.EditorView.domEventHandlers({
      mousedown: (e) => {
        const el = e.button === 0 && e.target.closest(".cm-sn-link, .cm-sn-tag");
        if (!el) return false;
        e.preventDefault();
        lpOpenLink(el, e);
        return true;
      },
      keydown: (e, view) => lpTableArrow(e, view),
    }),
  ];
}
