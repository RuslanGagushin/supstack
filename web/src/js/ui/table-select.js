/* =========================================================
   Selecting in a rendered table (live preview), as in Obsidian and Notion: a handle on the left of the row and on top of the column
   under the pointer selects the row or column (Shift extends it) and drags it somewhere else; dragging across cells, or Shift with a
   click or the arrows, selects a rectangle of cells. A selection is copied as a table (Markdown, and HTML for spreadsheets), cut,
   cleared, deleted, moved with Alt+arrows, and pasted over (a spreadsheet's cells or a Markdown table, the table growing to hold them).
   A bar over it has the actions for what is selected; the dots on a border between two rows or columns insert one there.
   The selection, sel = { from, a: [row, col], b: [row, col], kind: "cells" | "rows" | "cols" }, lasts while its table has the focus.
   ========================================================= */
import { wt } from "../core/i18n.js";
import { cellPlain, cellRaw, clipboardGrid, findTables, gridMarkdown, parseTable, tableGrid, tableRangeEdit, tableRect } from "../core/tables.js";
import { editor } from "../services/state.js";
import { $, $$, h, ic, isMod, setIcon } from "./dom.js";
import { saveEditor } from "./editor.js";
import { liveTa } from "./live-preview.js";
import { liveCellClose, liveCellOpen, liveTableEl, liveTableOp, tableMenu } from "./table-editor.js";

let sel = null, drag = null;
/** The selection in a rendered table, if any (for the tests). */
export const liveTableSel = () => sel;

const view = () => liveTa()?.cmView;
const hostAt = (from) => liveTableEl(from)?.querySelector(".sn-table-host") || null;
const tableAt = (from) => { const v = view(); return v ? findTables(v.state.doc.toString()).find((t) => t.from === from) || null : null; };
const fromOf = (host) => { const v = view(), el = host?.closest(".lp-table"); return v && el ? v.posAtDOM(el) : null; };
/** The rectangle selected: whole rows or columns for a row or column selection. */
function selRect(t = parseTable(tableAt(sel.from).lines)) {
  const r = tableRect(t, sel.a, sel.b);
  if (sel.kind === "rows") { r.c0 = 0; r.c1 = t.align.length - 1; }
  if (sel.kind === "cols") { r.r0 = 0; r.r1 = t.rows.length - 1; }
  return r;
}

/** Select from cell a to cell b of the table at `from` (kind: "cells", "rows" or "cols"); the table takes the focus. */
export function tableSelect(from, a, b = a, kind = "cells") {
  if (editor.cell) liveCellClose();
  sel = { from, a: [...a], b: [...b], kind };
  selShow();
}
export function tableSelClear() {
  const host = sel && hostAt(sel.from);
  sel = null;
  if (host) selPaint(host);
  $(".sn-table-bar")?.remove();
}
/** Draw the selection on its table, give the table the focus and put the bar over it. */
function selShow() {
  const host = hostAt(sel.from), tb = tableAt(sel.from);
  if (!host || !tb) { tableSelClear(); return; }
  const t = parseTable(tb.lines), clamp = ([r, c]) => [Math.max(0, Math.min(r, t.rows.length - 1)), Math.max(0, Math.min(c, t.align.length - 1))];
  sel.a = clamp(sel.a); sel.b = clamp(sel.b);
  selPaint(host, selRect(t));
  if (document.activeElement !== host) host.focus({ preventScroll: true });
  selBar(host, t);
}
function selPaint(host, r = null) {
  const tbl = host.querySelector("table");
  host.classList.toggle("has-selection", !!r);
  for (const c of $$(".is-cell-selected", host)) c.classList.remove("is-cell-selected");
  if (r && tbl) for (let i = r.r0; i <= r.r1; i++) for (let j = r.c0; j <= r.c1; j++) tbl.rows[i]?.cells[j]?.classList.add("is-cell-selected");
  tableHover(null, host);
}

/** Run a range op (core TABLE_RANGE_OPS) on the selection: what it returns stays selected; a new row or column has its cell edited. */
export function selOp(op, arg) {
  const v = view(), tb = sel && tableAt(sel.from);
  if (!v || !tb) return;
  const t = parseTable(tb.lines), out = tableRangeEdit(v.state.doc.toString(), tb, op, selRect(t), arg), from = sel.from, kind = sel.kind;
  v.dispatch({ changes: { from: out.from, to: out.to, insert: out.insert }, userEvent: "input.table" });
  if (!out.rect) { sel = null; $(".sn-table-bar")?.remove(); return; }
  const r = out.rect;
  if (/^(rowAbove|rowBelow|colLeft|colRight|rowDelete|colDelete)$/.test(op)) { tableSelClear(); liveCellOpen(from, r.r0, r.c0, { select: true }); return; }
  sel = { from, a: [r.r0, r.c0], b: [r.r1, r.c1], kind: op === "paste" ? "cells" : kind };
  selShow();
}

/* ---------- The clipboard */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The selected cells for the clipboard: a Markdown table as text, and an HTML table a spreadsheet or a document reads as cells. */
function selClip() {
  const grid = tableGrid(parseTable(tableAt(sel.from).lines), selRect());
  const html = "<table>" + grid.map((r) => "<tr>" + r.map((c) => "<td>" + esc(cellPlain(c)).replace(/\n/g, "<br>") + "</td>").join("") + "</tr>").join("") + "</table>";
  return { text: gridMarkdown(grid), html };
}
/** Cells from the clipboard: a Markdown table or a spreadsheet's tab-separated text, else an HTML table; null for plain text. */
function pastedGrid(dt) {
  const text = dt.getData("text/plain"), grid = text && clipboardGrid(text);
  if (grid) return grid;
  const html = dt.getData("text/html");
  if (!/<table/i.test(html)) return null;
  const tbl = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  const rows = [...(tbl?.rows || [])].map((tr) => [...tr.cells].map((c) => cellRaw(c.innerText ?? c.textContent).trim()));
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.length && w ? rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? "")) : null;
}
const selFocused = () => sel && document.activeElement === hostAt(sel.from);
document.addEventListener("copy", (e) => {
  if (!selFocused()) return;
  const c = selClip();
  e.clipboardData.setData("text/plain", c.text);
  e.clipboardData.setData("text/html", c.html);
  e.preventDefault();
}, true);
document.addEventListener("cut", (e) => {
  if (!selFocused()) return;
  const c = selClip();
  e.clipboardData.setData("text/plain", c.text);
  e.clipboardData.setData("text/html", c.html);
  e.preventDefault();
  selOp("clear");
}, true);
// over a selection: the cells go in from its top left cell; in a cell being edited, cells from a spreadsheet or a table go in from that cell
document.addEventListener("paste", (e) => {
  const c = editor.cell, inCell = c && c.el.contains(e.target);
  if (!inCell && !selFocused()) return;
  const grid = pastedGrid(e.clipboardData);
  if (inCell && (!grid || (grid.length === 1 && grid[0].length === 1))) return; // text for this cell: the cell's own paste
  e.preventDefault(); e.stopPropagation();
  if (inCell) { const { from, row, col } = c; tableSelect(from, [row, col]); }
  selOp("paste", grid || [[cellRaw(e.clipboardData.getData("text/plain"))]]);
}, true);
function copyNow(cut) {
  // a copy with nothing selected on the page fires no copy event everywhere (WebKit): ask for one, else write the text
  if (document.execCommand(cut ? "cut" : "copy")) return;
  navigator.clipboard?.writeText(selClip().text).catch(() => {});
  if (cut) selOp("clear");
}

/* ---------- Keys on a selection */
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
function selKeys(e) {
  if (!sel || e.isComposing || e.target.closest(".sn-cell-edit")) return;
  const tb = tableAt(sel.from);
  if (!tb) return;
  const t = parseTable(tb.lines), last = [t.rows.length - 1, t.align.length - 1], from = sel.from;
  const take = () => { e.preventDefault(); e.stopPropagation(); };
  const edit = (r, c, o = { select: true }) => { tableSelClear(); liveCellOpen(from, Math.max(0, Math.min(r, last[0])), Math.max(0, Math.min(c, last[1])), o); };
  const k = e.key.toLowerCase(), [br, bc] = sel.b;
  if (isMod(e)) {
    if (k === "a") { take(); tableSelect(from, [0, 0], last); }
    else if (k === "c" || k === "x") { take(); copyNow(k === "x"); }
    else if (k === "z" || k === "y") { take(); const v = view(); (k === "y" || e.shiftKey ? CM.redo : CM.undo)(v); tableSelClear(); }
    else if (k === "s") { take(); saveEditor(); }
    return;
  }
  if (e.altKey && !e.shiftKey && ARROWS[e.key]) {
    take();
    if (sel.kind === "cols" || (sel.kind === "cells" && ARROWS[e.key][1])) { if (ARROWS[e.key][1]) selOp(ARROWS[e.key][1] < 0 ? "colMoveLeft" : "colMoveRight"); }
    else if (ARROWS[e.key][0]) selOp(ARROWS[e.key][0] < 0 ? "rowUp" : "rowDown");
    return;
  }
  if (e.altKey) return;
  if (e.shiftKey && ARROWS[e.key]) {
    take();
    const r = selRect(t), [dr, dc] = ARROWS[e.key];
    // a row or column selection grows by rows or columns; otherwise from its anchor cell
    if (sel.kind !== "cells") { sel.a = [r.r0, r.c0]; sel.b = [r.r1, r.c1]; if ((sel.kind === "rows" && dc) || (sel.kind === "cols" && dr)) sel.kind = "cells"; }
    sel.b = [Math.max(sel.kind === "rows" ? 1 : 0, Math.min(sel.b[0] + dr, last[0])), Math.max(0, Math.min(sel.b[1] + dc, last[1]))];
    selShow();
    return;
  }
  if (ARROWS[e.key]) { take(); edit(br + ARROWS[e.key][0], bc + ARROWS[e.key][1]); return; }
  if (e.key === "Escape") { take(); tableSelClear(); document.activeElement?.blur(); return; }
  if (e.key === "Enter" || e.key === "F2") { take(); edit(br, bc, e.key === "F2" ? {} : { select: true }); return; }
  if (e.key === "Tab") { take(); const n = br * (last[1] + 1) + bc + (e.shiftKey ? -1 : 1); edit(Math.floor(n / (last[1] + 1)), ((n % (last[1] + 1)) + last[1] + 1) % (last[1] + 1)); return; }
  if (e.key === "Delete" || e.key === "Backspace") { take(); selOp(sel.kind === "rows" ? "rowDelete" : sel.kind === "cols" ? "colDelete" : "clear"); return; }
  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { take(); const r = $(".sn-table-bar")?.getBoundingClientRect() || hostAt(from).getBoundingClientRect(); selMenu().showAt(r.left, r.bottom + 4); return; }
  // typing over a selection starts the cell over with what is typed, as in a spreadsheet
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { take(); edit(br, bc); document.execCommand("insertText", false, e.key); }
}

/* ---------- The bar over a selection, and its menu */
const OP_ICONS = {
  rowAbove: "arrow-up-to-line", rowBelow: "arrow-down-to-line", rowUp: "chevron-up", rowDown: "chevron-down",
  colLeft: "arrow-left-to-line", colRight: "arrow-right-to-line", colMoveLeft: "chevron-left", colMoveRight: "chevron-right",
  alignLeft: "align-left", alignCenter: "align-center", alignRight: "align-right", sortAsc: "arrow-down-a-z", sortDesc: "arrow-up-z-a",
};
const OP_TITLES = {
  rowAbove: "tblRowAbove", rowBelow: "tblRowBelow", rowUp: "tblRowUp", rowDown: "tblRowDown", rowDelete: "tblRowDelete",
  colLeft: "tblColLeft", colRight: "tblColRight", colMoveLeft: "tblColMoveLeft", colMoveRight: "tblColMoveRight", colDelete: "tblColDelete",
  alignLeft: "tblAlignLeft", alignCenter: "tblAlignCenter", alignRight: "tblAlignRight", sortAsc: "tblSortAsc", sortDesc: "tblSortDesc", clear: "tblClear",
};
function selMenu() {
  const r = selRect();
  return tableMenu((op) => selOp(op), sel.kind === "cols" ? 0 : r.r0, { clear: true });
}
function selBar(host, t) {
  let bar = $(".sn-table-bar");
  const r = selRect(t), key = sel.kind + (r.r0 === 0 ? "h" : "");
  if (!bar || bar.dataset.kind !== key) {
    bar?.remove();
    bar = h("div", { cls: "sn-table-bar", role: "toolbar", "aria-label": wt("tblBar"), dataset: { kind: key } });
    // the buttons act on mousedown and keep the focus on the table, so the selection stays
    const btn = (icon, title, fn, cls = "") => {
      const b = h("button", { type: "button", cls: "sn-tb-btn" + cls, title, "aria-label": title, dataset: { act: icon } });
      setIcon(b, icon);
      b.addEventListener("mousedown", (e) => { if (e.button === 0) { e.preventDefault(); fn(b); } });
      b.addEventListener("click", (e) => { if (e.detail === 0) fn(b); });
      bar.append(b);
    };
    const op = (o) => btn(OP_ICONS[o], wt(OP_TITLES[o]), () => selOp(o));
    const sep = () => bar.append(h("span", { cls: "sn-tb-sep", "aria-hidden": "true" }));
    if (sel.kind === "rows") { op("rowAbove"); op("rowBelow"); sep(); op("rowUp"); op("rowDown"); }
    else if (sel.kind === "cols") { op("colLeft"); op("colRight"); sep(); op("colMoveLeft"); op("colMoveRight"); sep(); op("alignLeft"); op("alignCenter"); op("alignRight"); sep(); op("sortAsc"); op("sortDesc"); }
    else { btn("copy", wt("tblCopy"), () => copyNow(false)); btn("eraser", wt("tblClear"), () => selOp("clear")); sep(); op("alignLeft"); op("alignCenter"); op("alignRight"); }
    if (sel.kind === "rows" && r.r0 > 0) btn("trash-2", wt("tblRowDelete"), () => selOp("rowDelete"), " is-warn");
    if (sel.kind === "cols") btn("trash-2", wt("tblColDelete"), () => selOp("colDelete"), " is-warn");
    sep();
    btn("ellipsis", wt("tblMore"), (b) => selMenu().showBelow(b));
    document.body.append(bar);
  }
  for (const b of $$("[data-act^='align-']", bar)) b.classList.toggle("is-active", t.align.slice(r.c0, r.c1 + 1).every((a) => a === b.dataset.act.slice(6)));
  selBarPlace(host, r);
}
/** Over the table, above the selected cells. */
function selBarPlace(host = sel && hostAt(sel.from), r = sel && selRect()) {
  const bar = $(".sn-table-bar"), tbl = host?.querySelector("table");
  if (!bar || !tbl || !r) return;
  const a = tbl.rows[r.r0].cells[r.c0].getBoundingClientRect(), z = tbl.rows[r.r1].cells[r.c1].getBoundingClientRect();
  const w = bar.offsetWidth, hgt = bar.offsetHeight, left = Math.max(8, Math.min(innerWidth - w - 8, (a.left + z.right) / 2 - w / 2));
  // over the table, clear of the column handles, so it hides no cell; over the selection when the table's top is scrolled away
  const top0 = tbl.getBoundingClientRect().top - hgt - 12, top = top0 >= 8 ? top0 : a.top - hgt - 8 >= 8 ? a.top - hgt - 8 : Math.min(z.bottom + 8, innerHeight - hgt - 8);
  Object.assign(bar.style, { left: left + "px", top: top + "px" });
}
document.addEventListener("scroll", () => { if (sel) selBarPlace(); }, { capture: true, passive: true });
window.addEventListener("resize", () => { if (sel) selBarPlace(); });

/* ---------- Handles, insert dots and dragging */
/** The handles, insert dots and drop line of a rendered table (table-editor.js liveTableButtons makes the host). */
export function tableHandles(host) {
  host.tabIndex = -1;
  host.addEventListener("keydown", selKeys);
  // the selection goes when the focus leaves the table and its bar
  host.addEventListener("focusout", () => setTimeout(() => {
    if (sel && !drag && !document.activeElement?.closest(".sn-table-host, .sn-table-bar, .menu") && !$(".menu")) tableSelClear();
  }, 0));
  const handle = (k) => {
    const b = h("button", { type: "button", cls: `sn-table-handle sn-table-${k}-handle`, title: wt(k === "row" ? "tblRowHandle" : "tblColHandle"), "aria-label": wt(k === "row" ? "tblRowHandle" : "tblColHandle") },
      ic("", k === "row" ? "grip-vertical" : "grip-horizontal"));
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("pointerdown", (e) => handleDown(e, b, k));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); if (sel) selMenu().showAtEvent(e); });
    // from the keyboard (detail 0): select its row or column
    b.addEventListener("click", (e) => { if (e.detail === 0) handlePick(b, k, e.shiftKey); });
    return b;
  };
  const dot = (k) => {
    const b = h("button", { type: "button", cls: `sn-table-ins sn-table-ins-${k}`, title: wt(k === "row" ? "tblInsertRow" : "tblInsertCol"), "aria-label": wt(k === "row" ? "tblInsertRow" : "tblInsertCol") }, ic("", "plus"));
    b.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const at = Number(b.dataset.at), tbl = host.querySelector("table");
      if (k === "row") liveTableOp(b, at >= tbl.rows.length ? "rowBelow" : "rowAbove", { row: Math.min(at, tbl.rows.length - 1), col: 0, edit: true });
      else liveTableOp(b, "colLeft", { row: 0, col: at, edit: true });
    });
    return b;
  };
  host.append(handle("row"), handle("col"), dot("row"), dot("col"), h("div", { cls: "sn-table-drop", "aria-hidden": "true" }));
  host.querySelector(".sn-table-wrap")?.addEventListener("scroll", () => tableHover(null, host), { passive: true });
}
/** Handles for the row and column under the pointer (or of the cell being edited, on a touch screen), dots on a border near it. */
export function tableHover(e, host) {
  if (drag || !host) return;
  if (e?.target.closest(".sn-table-handle, .sn-table-ins")) return;
  const tbl = host.querySelector("table"), wrap = host.querySelector(".sn-table-wrap");
  if (!tbl || !wrap) return;
  let cell = e?.target.closest("td, th");
  if (cell && !tbl.contains(cell)) cell = null;
  if (!cell && editor.cell && host.contains(editor.cell.el)) cell = editor.cell.el.closest("td, th");
  const hr = host.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const [rh, chd, ir, iC] = [".sn-table-row-handle", ".sn-table-col-handle", ".sn-table-ins-row", ".sn-table-ins-col"].map((s) => host.querySelector(s));
  const show = (el, on, style) => { el.classList.toggle("is-shown", !!on); if (on) Object.assign(el.style, style); };
  const row = cell ? cell.parentElement.rowIndex : -1, col = cell ? cell.cellIndex : -1;
  const keepRow = sel?.kind === "rows" && hostAt(sel.from) === host, keepCol = sel?.kind === "cols" && hostAt(sel.from) === host;
  // a handle stays on a selected row or column while the pointer is elsewhere, so it can be dragged
  const hRow = row > 0 ? row : keepRow ? selRect().r0 : -1, hCol = col >= 0 ? col : keepCol ? selRect().c0 : -1;
  if (hRow > 0) { const r = tbl.rows[hRow].getBoundingClientRect(); rh.dataset.row = hRow; show(rh, true, { top: r.top - hr.top + r.height / 2 + "px" }); } else show(rh, false);
  const cr = hCol >= 0 && tbl.rows[0].cells[hCol]?.getBoundingClientRect();
  if (cr && cr.right > wr.left + 8 && cr.left < wr.right - 8) { chd.dataset.col = hCol; show(chd, true, { left: Math.max(wr.left, Math.min(wr.right, cr.left + cr.width / 2)) - hr.left + "px" }); } else show(chd, false);
  // a dot where the pointer is near a border between rows (at the table's left edge) or between columns (along the header)
  const x = e?.clientX, y = e?.clientY, near = 7;
  let rowAt = -1, colAt = -1, ry = 0, cx = 0;
  if (cell && x - wr.left < 28) {
    const r = cell.parentElement.getBoundingClientRect();
    if (row > 0 && Math.abs(y - r.top) < near) { rowAt = row; ry = r.top; }
    else if (row > 0 && Math.abs(y - r.bottom) < near) { rowAt = row + 1; ry = r.bottom; }
  }
  if (cell && row === 0) {
    const r = cell.getBoundingClientRect();
    if (Math.abs(x - r.left) < near && r.left > wr.left + 2) { colAt = col; cx = r.left; }
    else if (Math.abs(x - r.right) < near) { colAt = col + 1; cx = Math.min(r.right, wr.right); }
  }
  const sr = (keepRow || keepCol) && selRect();
  rh.classList.toggle("is-active", !!keepRow && hRow >= sr.r0 && hRow <= sr.r1);
  chd.classList.toggle("is-active", !!keepCol && hCol >= sr.c0 && hCol <= sr.c1);
  ir.dataset.at = rowAt; iC.dataset.at = colAt;
  show(ir, rowAt > 0, { top: ry - hr.top + "px" });
  show(iC, colAt >= 0, { left: cx - hr.left + "px" });
}
export function tableHoverEnd(host) {
  if (drag || !host) return;
  for (const el of $$(".sn-table-ins.is-shown", host)) el.classList.remove("is-shown");
  tableHover(null, host);
}
/** A click on a handle selects its row or column; Shift extends a selection of rows or columns there. */
function handlePick(b, k, extend) {
  const host = b.closest(".sn-table-host"), from = fromOf(host);
  if (from == null) return;
  const i = Number(b.dataset[k]), cols = host.querySelector("table").rows[0].cells.length, rows = host.querySelector("table").rows.length;
  const same = sel && sel.from === from && sel.kind === k + "s";
  if (k === "row") tableSelect(from, extend && same ? sel.a : [i, 0], [i, cols - 1], "rows");
  else tableSelect(from, extend && same ? sel.a : [0, i], [rows - 1, i], "cols");
}
/** Down on a handle: its row or column is selected (or the selection it is part of stays), and moving drags it. */
function handleDown(e, b, k) {
  if (e.button !== 0) return;
  e.preventDefault();
  const host0 = b.closest(".sn-table-host"), from = fromOf(host0), i = Number(b.dataset[k]);
  if (from == null) return;
  const inSel = sel && sel.from === from && sel.kind === k + "s" && (() => { const r = selRect(); return k === "row" ? i >= r.r0 && i <= r.r1 : i >= r.c0 && i <= r.c1; })();
  if (!inSel || e.shiftKey) handlePick(b, k, e.shiftKey);
  if (!sel) return;
  const x0 = e.clientX, y0 = e.clientY;
  drag = { from, k, on: false, to: -1 };
  const move = (ev) => {
    if (!drag.on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    const host = hostAt(from), tbl = host?.querySelector("table"), line = host?.querySelector(".sn-table-drop");
    if (!tbl) return;
    drag.on = true;
    host.classList.add("is-dragging");
    $(".sn-table-bar")?.classList.add("is-hidden");
    const hr = host.getBoundingClientRect(), tr = tbl.getBoundingClientRect(), wr = host.querySelector(".sn-table-wrap").getBoundingClientRect();
    if (k === "row") {
      const rows = [...tbl.rows];
      let to = rows.findIndex((r, j) => j > 0 && ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (to < 0) to = rows.length;
      drag.to = Math.max(1, to);
      const y = drag.to < rows.length ? rows[drag.to].getBoundingClientRect().top : tr.bottom;
      Object.assign(line.style, { top: y - hr.top - 1 + "px", left: "0px", width: Math.min(tr.width, wr.width) + "px", height: "", });
      line.className = "sn-table-drop is-shown is-row";
    } else {
      const cells = [...tbl.rows[0].cells];
      let to = cells.findIndex((c) => ev.clientX < c.getBoundingClientRect().left + c.offsetWidth / 2);
      if (to < 0) to = cells.length;
      drag.to = to;
      const x = to < cells.length ? cells[to].getBoundingClientRect().left : tr.right;
      Object.assign(line.style, { left: Math.max(wr.left, Math.min(wr.right, x)) - hr.left - 1 + "px", top: "0px", height: Math.min(tr.height, wr.height) + "px", width: "" });
      line.className = "sn-table-drop is-shown is-col";
    }
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    const d = drag;
    drag = null;
    const host = hostAt(from);
    host?.classList.remove("is-dragging");
    host?.querySelector(".sn-table-drop")?.classList.remove("is-shown");
    $(".sn-table-bar")?.classList.remove("is-hidden");
    if (d.on && d.to >= 0 && sel) selOp(k === "row" ? "moveRows" : "moveCols", d.to);
    else if (sel) selShow();
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
}

/* ---------- Cells: Shift+click extends, a drag across cells selects them */
/** Mousedown on a cell of a rendered table (live-preview.js): true when it was a Shift+click that selected cells. */
export function tableCellDown(e, cell, at) {
  const c = editor.cell, from = at.tb.from, here = [at.row, at.col];
  if (!e.shiftKey) return false;
  const anchor = sel?.from === from ? sel.a : c?.from === from ? [c.row, c.col] : null;
  if (!anchor) return false;
  e.preventDefault();
  tableSelect(from, anchor, here);
  return true;
}
/** After a cell is opened by a mousedown: moving onto another cell turns it into a selection of cells, which follows the pointer. */
export function tableCellDrag(e, at) {
  const from = at.tb.from, a = [at.row, at.col];
  const cellAt = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("td, th"), host = hostAt(from);
    return el && host?.contains(el) && !el.closest(".sn-cell-edit") ? [el.parentElement.rowIndex, el.cellIndex] : null;
  };
  const move = (ev) => {
    const b = cellAt(ev);
    if (!b) return;
    if (!sel && b[0] === a[0] && b[1] === a[1]) return;
    if (!sel || sel.from !== from) { getSelection().removeAllRanges(); tableSelect(from, a, b); return; }
    if (sel.b[0] !== b[0] || sel.b[1] !== b[1]) { sel.b = b; selShow(); }
  };
  const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
}
/** In a cell being edited, Shift+arrow past the edge of its text selects cells from it. */
export function tableCellShiftKey(e, c, s, en, len) {
  if (!e.shiftKey || e.altKey || isMod(e) || !ARROWS[e.key]) return false;
  const all = s === 0 && en === len;
  const edge = { ArrowUp: true, ArrowDown: true, ArrowLeft: all || (s === 0 && en === 0), ArrowRight: all || (s === len && en === len) }[e.key];
  if (!edge) return false;
  const [dr, dc] = ARROWS[e.key], t = c.t, b = [Math.max(0, Math.min(c.row + dr, t.rows.length - 1)), Math.max(0, Math.min(c.col + dc, t.align.length - 1))];
  e.preventDefault(); e.stopPropagation();
  tableSelect(c.from, [c.row, c.col], b);
  return true;
}
/** Right click in a rendered table: on the selection, its menu (true); elsewhere the selection goes (false: the cell's menu). */
export function tableSelMenuAt(e, at) {
  if (sel && sel.from === at.tb.from) {
    const r = selRect();
    if (at.row >= r.r0 && at.row <= r.r1 && at.col >= r.c0 && at.col <= r.c1) { e.preventDefault(); e.stopPropagation(); selMenu().showAtEvent(e); return true; }
  }
  tableSelClear();
  return false;
}
