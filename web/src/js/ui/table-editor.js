/* =========================================================
   Tables in the editor: the table menu, Tab / Enter between cells in the source,
   and cells edited one at a time in a rendered table (live preview). core/tables.js does the text.
   ========================================================= */
import { wt } from "../core/i18n.js";
import { findTables, formatTable, parseTable, TABLE_OPS, tableCellAt, tableEdit } from "../core/tables.js";
import { editor } from "../services/state.js";
import { syncHook } from "../services/sync.js";
import { $$, h, ic, isMod } from "./dom.js";
import { Menu } from "./ui.js";
import { saveEditor, scheduleSave, setSaveState } from "./editor.js";
import { liveActivate, liveTa, lpTableFill } from "./live-preview.js";
import { edInsert, updateEdToolbar } from "./editor-toolbar.js";

export function tableMenu(run, row) {
  const m = new Menu();
  m.label(wt("tblRow"));
  if (row > 0) m.add(wt("tblRowAbove"), "arrow-up-to-line", () => run("rowAbove"));
  m.add(wt("tblRowBelow"), "arrow-down-to-line", () => run("rowBelow"));
  if (row > 1) m.add(wt("tblRowUp"), "chevron-up", () => run("rowUp"));
  if (row > 0) m.add(wt("tblRowDown"), "chevron-down", () => run("rowDown"));
  if (row > 0) m.add(wt("tblRowDelete"), "trash-2", () => run("rowDelete"), { warning: true });
  m.sep().label(wt("tblCol"));
  m.add(wt("tblColLeft"), "arrow-left-to-line", () => run("colLeft"));
  m.add(wt("tblColRight"), "arrow-right-to-line", () => run("colRight"));
  m.add(wt("tblColMoveLeft"), "chevron-left", () => run("colMoveLeft"));
  m.add(wt("tblColMoveRight"), "chevron-right", () => run("colMoveRight"));
  m.add(wt("tblAlignLeft"), "align-left", () => run("alignLeft"));
  m.add(wt("tblAlignCenter"), "align-center", () => run("alignCenter"));
  m.add(wt("tblAlignRight"), "align-right", () => run("alignRight"));
  m.add(wt("tblSortAsc"), "arrow-down-a-z", () => run("sortAsc"));
  m.add(wt("tblSortDesc"), "arrow-up-z-a", () => run("sortDesc"));
  m.add(wt("tblColDelete"), "trash-2", () => run("colDelete"), { warning: true });
  m.sep().add(wt("tblFormat"), "wand-sparkles", () => run("format"));
  return m;
}
/** The table under the caret of a textarea, with the caret's cell. */
export function editorTable(ta) {
  const s = ta.selectionStart, tb = findTables(ta.value).find((x) => s >= x.from && s <= x.to);
  return tb ? { tb, ...tableCellAt(tb, s - tb.from) } : null;
}
export function editorTableOp(ta, op, at = editorTable(ta)) {
  if (!at) return;
  const out = tableEdit(ta.value, at.tb, op, at.row, at.col);
  edInsert(ta, out.from, out.to, out.insert, ...out.sel);
}
/** Table keys in the editor (true when the key was used): Tab / Shift+Tab to the next / previous cell (a new row after the last),
   Enter to the cell below (a new row after the last; on an empty last row the table ends), Shift+Enter a line break in the cell,
   Alt+arrows move the row or column. */
export function editorTableKey(e, ta) {
  if (e.isComposing || isMod(e) || !(e.key === "Tab" || e.key === "Enter" || (e.altKey && !e.shiftKey && /^Arrow/.test(e.key)))) return false;
  if (e.key === "Enter" && ta.selectionStart !== ta.selectionEnd) return false;
  const at = editorTable(ta);
  if (!at) return false;
  e.preventDefault();
  const t = parseTable(at.tb.lines), last = t.rows.length - 1, cols = t.align.length;
  const go = (row, col, op = "format") => { editorTableOp(ta, op, { ...at, row, col }); return true; };
  if (e.altKey) return go(at.row, at.col, { ArrowUp: "rowUp", ArrowDown: "rowDown", ArrowLeft: "colMoveLeft", ArrowRight: "colMoveRight" }[e.key]);
  if (e.key === "Tab" && e.shiftKey) return at.col > 0 ? go(at.row, at.col - 1) : go(Math.max(0, at.row - 1), at.row ? cols - 1 : 0);
  if (e.key === "Tab") return at.col < cols - 1 ? go(at.row, at.col + 1) : at.row < last ? go(at.row + 1, 0) : go(at.row, 0, "rowBelow");
  if (e.shiftKey) { edInsert(ta, ta.selectionStart, ta.selectionStart, "<br>"); return true; }
  if (at.row === last && at.row > 0 && t.rows[last].every((c) => !c)) {
    // a line right under a table would be one more row, so the text goes on after a blank line
    t.rows.pop();
    const f = formatTable(t).text + "\n\n";
    edInsert(ta, at.tb.from, at.tb.to, f, at.tb.from + f.length);
    return true;
  }
  return at.row < last ? go(at.row + 1, at.col) : go(at.row, at.col, "rowBelow");
}
/** The rendered table `x` is in (a cell, a + button): its table in the document and the cell. */
export function liveTableAt(x) {
  const el = x.closest(".lp-table"), view = liveTa()?.cmView, tbl = el?.querySelector("table");
  if (!el || !view || !tbl) return null;
  const from = view.posAtDOM(el), tb = findTables(view.state.doc.toString()).find((t) => t.from === from);
  const cell = x.closest("td, th");
  return tb ? { s: 0, tb, tbl, row: cell ? cell.parentElement.rowIndex : 0, col: cell ? cell.cellIndex : 0 } : null;
}
/** Run a table op on a rendered table (`x` is in it, or x.from is where it starts); o.edit then edits the caret's cell. */
export function liveTableOp(x, op, o = {}) {
  const view = liveTa()?.cmView, at = x.from != null ? x : liveTableAt(x);
  if (!at || !view) return;
  liveCellClose({ save: false });
  const from = at.tb?.from ?? at.from, tb = findTables(view.state.doc.toString()).find((t) => t.from === from);
  if (!tb) return;
  const out = tableEdit(view.state.doc.toString(), tb, op, o.row ?? at.row, o.col ?? at.col);
  view.dispatch({ changes: { from: out.from, to: out.to, insert: out.insert }, userEvent: "input.table" });
  if (!o.edit || !out.insert) return;
  const at2 = tableCellAt({ ...tb, lines: out.insert.split("\n") }, out.sel[0] - out.from);
  liveCellOpen(out.from, at2.row, at2.col, { select: true });
}
/* ---------- A table in live preview stays rendered while it is edited: one cell at a time holds an editor
   with the cell's Markdown, and the table's text is rewritten (lined up) as you type.
   editor.cell = { el, from, to, row, col, t }: the cell's editor, the table's [from, to) in the document and the parsed table. */
export const cellCaret = (el) => {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return [el.textContent.length, el.textContent.length];
  const r = sel.getRangeAt(0), pre = document.createRange();
  pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  const s = pre.toString().length;
  return [s, s + r.toString().length];
};
export function cellSetCaret(el, s, e = s) {
  const node = el.firstChild || el.appendChild(document.createTextNode("")), n = node.length;
  const r = document.createRange();
  r.setStart(node, Math.min(s, n)); r.setEnd(node, Math.min(e, n));
  getSelection().removeAllRanges(); getSelection().addRange(r);
}
/** The rendered table at document offset `from`, and one of its cells. */
function liveTableEl(from) { const view = liveTa()?.cmView; return view ? $$("#editor .lp-table").find((el) => view.posAtDOM(el) === from) || null : null; }
const liveCellAt = (from, row, col) => liveTableEl(from)?.querySelector("table")?.rows[row]?.cells[col] || null;
/** Edit one cell of a rendered table: o.caret puts the caret at that offset in the cell's text, o.select selects it all, o.atStart / the default the end. */
export function liveCellOpen(from, row, col, o = {}) {
  const view = liveTa()?.cmView;
  if (!view) return null;
  liveCellClose({ save: false });
  const tb = findTables(view.state.doc.toString()).find((x) => x.from === from), td = tb && liveCellAt(from, row, col);
  if (!td) return null;
  const t = parseTable(tb.lines), text = t.rows[row][col];
  const el = h("span", { cls: "sn-cell-edit", spellcheck: "true", text });
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  td.replaceChildren(el);
  td.classList.add("is-editing");
  editor.cell = { el, from, to: tb.to, row, col, t };
  el.addEventListener("input", liveCellInput);
  el.addEventListener("keydown", liveCellKeys);
  el.addEventListener("blur", () => setTimeout(() => { if (editor.cell?.el === el && document.activeElement !== el) liveCellClose(); }, 0));
  el.focus({ preventScroll: true });
  cellSetCaret(el, o.select ? 0 : o.atStart ? 0 : o.caret ?? text.length, o.select ? text.length : o.atStart ? 0 : o.caret ?? text.length);
  updateEdToolbar();
  return el;
}
/** The cell's text into the note: pipes are escaped, line breaks become <br>. */
function liveCellInput() {
  const c = editor.cell;
  if (!c) return;
  c.t.rows[c.row][c.col] = c.el.textContent.replace(/\r?\n/g, "<br>").replace(/\\?\|/g, (m) => (m.length > 1 ? m : "\\|"));
  liveCellWrite(formatTable(c.t).text);
  editor.dirty = true; setSaveState(); scheduleSave();
  syncHook("modify", editor.path, 250);
}
/** Replace the table's text in the document; the table widget keeps its DOM while the cell is edited. */
function liveCellWrite(text) {
  const c = editor.cell, view = liveTa()?.cmView;
  view.dispatch({ changes: { from: c.from, to: c.to, insert: text } });
  c.to = c.from + text.length;
}
/** Close the cell editor: its table renders again. */
function liveCellClose(o = {}) {
  const c = editor.cell, view = liveTa()?.cmView;
  editor.cell = null;
  const el = c?.el.closest(".lp-table");
  if (!el?.isConnected || !view) return;
  lpTableFill(el, view.state.sliceDoc(c.from, c.to));
  if (o.save !== false && editor.dirty) saveEditor();
}
/** Move the cell editor to another cell after op (TABLE_OPS) on the table; the table renders with the change. */
function liveCellGo(row, col, op = "format", o = {}) {
  const c = editor.cell;
  const res = TABLE_OPS[op](c.t, row, col);
  liveCellWrite(formatTable(c.t).text);
  if (op !== "format") { editor.dirty = true; setSaveState(); scheduleSave(); }
  liveCellClose({ save: false });
  liveCellOpen(c.from, ...res, o);
}
/** Leave the table for the nearest line with text above (up) or below it (down); o.newLine starts a new paragraph right under the table
   (after a blank line: a line right under a table would be one more row), as does going down from a table at the end of the note. */
function liveCellLeave(down, o = {}) {
  const c = editor.cell, ta = liveTa(), view = ta?.cmView;
  liveCellClose({ save: false });
  if (!view) return;
  const doc = view.state.doc, near = (n, step) => { while (n >= 1 && n <= doc.lines && !doc.line(n).text.trim()) n += step; return n >= 1 && n <= doc.lines ? doc.line(n) : null; };
  if (!down) { const l = near(doc.lineAt(c.from).number - 1, -1); if (l) liveActivate(l.to); return; }
  const l = !o.newLine && near(doc.lineAt(c.to).number + 1, 1);
  if (l) { liveActivate(l.from); return; }
  ta.focus({ preventScroll: true }); // first: CodeMirror reads the browser's caret when it gets the focus
  view.dispatch({ changes: { from: c.to, insert: "\n\n" }, selection: { anchor: c.to + 2 }, userEvent: "input.table" });
  updateEdToolbar();
}
/** Keys in a cell: Tab / Shift+Tab and Enter move on as in the source (a new row after the last; Enter on an empty last row ends the table),
   Shift+Enter a <br>, arrows at the edge of the text go to the next cell or out of the table, Alt+arrows move the row or column, Escape stops editing. */
function liveCellKeys(e) {
  const c = editor.cell;
  if (!c || e.isComposing) return;
  const take = () => { e.preventDefault(); e.stopPropagation(); };
  const last = c.t.rows.length - 1, cols = c.t.align.length, len = c.el.textContent.length, [s, en] = cellCaret(c.el);
  if (isMod(e)) {
    const k = e.key.toLowerCase();
    if (k === "s") { take(); saveEditor(); }
    else if (k === "b" || k === "i") {
      take();
      const mark = k === "b" ? "**" : "*", v = c.el.textContent;
      c.el.textContent = v.slice(0, s) + mark + v.slice(s, en) + mark + v.slice(en);
      cellSetCaret(c.el, s + mark.length, en + mark.length);
      liveCellInput();
    }
    return;
  }
  if (e.altKey && !e.shiftKey && /^Arrow/.test(e.key)) { take(); liveCellGo(c.row, c.col, { ArrowUp: "rowUp", ArrowDown: "rowDown", ArrowLeft: "colMoveLeft", ArrowRight: "colMoveRight" }[e.key], { caret: s }); return; }
  if (e.altKey) return;
  if (e.key === "Escape") { take(); liveCellClose(); return; }
  if (e.key === "Tab") {
    take();
    if (e.shiftKey) { if (c.col > 0) liveCellGo(c.row, c.col - 1, "format", { select: true }); else if (c.row > 0) liveCellGo(c.row - 1, cols - 1, "format", { select: true }); return; }
    if (c.col < cols - 1) liveCellGo(c.row, c.col + 1, "format", { select: true });
    else if (c.row < last) liveCellGo(c.row + 1, 0, "format", { select: true });
    else liveCellGo(c.row, 0, "rowBelow", { select: true });
    return;
  }
  if (e.key === "Enter") {
    take();
    if (e.shiftKey) { document.execCommand("insertText", false, "<br>"); return; }
    if (c.row === last && c.row > 0 && c.t.rows[last].every((x) => !x)) {
      // an empty last row: it goes, and the text goes on in a new block under the table
      c.t.rows.pop();
      liveCellWrite(formatTable(c.t).text);
      editor.dirty = true; setSaveState(); scheduleSave();
      liveCellLeave(true, { newLine: true });
      return;
    }
    if (c.row < last) liveCellGo(c.row + 1, c.col, "format", { select: true }); else liveCellGo(c.row, c.col, "rowBelow", { select: true });
    return;
  }
  if (s !== en || e.shiftKey) return;
  if (e.key === "ArrowLeft" && s === 0 && (c.col > 0 || c.row > 0)) { take(); liveCellGo(c.col ? c.row : c.row - 1, c.col ? c.col - 1 : cols - 1); }
  else if (e.key === "ArrowRight" && s === len && (c.col < cols - 1 || c.row < last)) { take(); liveCellGo(c.col < cols - 1 ? c.row : c.row + 1, c.col < cols - 1 ? c.col + 1 : 0, "format", { atStart: true }); }
  else if (e.key === "ArrowUp") { take(); if (c.row > 0) liveCellGo(c.row - 1, c.col); else liveCellLeave(false); }
  else if (e.key === "ArrowDown") { take(); if (c.row < last) liveCellGo(c.row + 1, c.col); else liveCellLeave(true); }
}
/** In live preview a rendered table gets + buttons for a new row (below) and a new column (on the right). */
export function liveTableButtons(el) {
  for (const wrap of $$(".sn-table-wrap", el)) {
    if (wrap.closest("blockquote, .callout")) continue;
    const host = h("div", { cls: "sn-table-host" });
    // the button acts on mousedown and keeps the focus where it is: a click would come after the focus left the cell being edited
    // (or the editor), which redraws the table, and in WebKit the button pressed is gone by then, so it took a second click.
    // A click from the keyboard (detail 0) still works.
    const add = (cls, title, fn) => {
      const b = h("button", { type: "button", cls, title, "aria-label": title }, ic("", "plus"));
      b.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); fn(b); });
      b.addEventListener("click", (e) => { e.stopPropagation(); if (e.detail === 0) fn(b); });
      return b;
    };
    wrap.replaceWith(host);
    host.append(wrap,
      add("sn-table-add-row", wt("tblRowBelow"), (b) => liveTableOp(b, "rowBelow", { row: host.querySelector("table").rows.length - 1, col: 0, edit: true })),
      add("sn-table-add-col", wt("tblColRight"), (b) => liveTableOp(b, "colRight", { row: 0, col: host.querySelector("table").rows[0].cells.length - 1, edit: true })));
  }
}
