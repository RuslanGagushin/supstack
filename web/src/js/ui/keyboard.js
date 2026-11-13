/* =========================================================
   Keyboard on the board
   ========================================================= */
import { board, editor, graph, UI, vault } from "../services/state.js";
import { manualCmp } from "../services/vault.js";
import { undo } from "../services/save.js";
import { $, $$, isMod } from "./dom.js";
import { closeMenu, modalStack, openMenuEl } from "./ui.js";
import { deleteCards, promptAddTag, quickOpen, tagTargets } from "./actions.js";
import { goBack, lastFocused, renderBoard, setTarget, toggleSearch, toggleSelect } from "./board.js";
import { closeEditor, openEditor } from "./editor.js";
import { toggleReading } from "./editor-toolbar.js";
import { enterRow, leaveRow } from "./cards.js";
import { commandPalette, hotkeysModal, setSide } from "./shell.js";
import { openToday, setFocusMode } from "./completion.js";
import { openTasksView } from "./agenda.js";
import { openFilesView } from "./files.js";

function spatialNext(from, dir) {
  const cards = [...$$(".sn-board .sn-rows .sn-card")];
  if (!from) return cards[0];
  // the list of notes reads in order: up and down step through the notebooks' tiles row by row, then the notes (restyle RS-27);
  // right and left keep going into a notebook and back out
  if ((dir === "ArrowDown" || dir === "ArrowUp") && from.closest(".sn-board.is-notes")) return cards[cards.indexOf(from) + (dir === "ArrowDown" ? 1 : -1)] || null;
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const c of cards) {
    if (c === from) continue;
    const q = c.getBoundingClientRect();
    const x = q.left + q.width / 2, y = q.top + q.height / 2;
    const dx = x - cx, dy = y - cy;
    let primary, secondary;
    if (dir === "ArrowDown") { if (q.top < r.bottom - 4) continue; primary = dy; secondary = Math.abs(dx); }
    else if (dir === "ArrowUp") { if (q.bottom > r.top + 4) continue; primary = -dy; secondary = Math.abs(dx); }
    else if (dir === "ArrowRight") { if (q.left < r.right - 4) continue; primary = dx; secondary = Math.abs(dy); }
    else { if (q.right > r.left + 4) continue; primary = -dx; secondary = Math.abs(dy); }
    const score = primary + secondary * 2.5;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
// the keyboard is being used to get around: Tab marks it, the pointer clears it (the list's and agenda's focus rings follow it)
document.addEventListener("keydown", (e) => { if (e.key === "Tab") document.body.classList.add("sn-kb"); }, true);
document.addEventListener("pointerdown", () => document.body.classList.remove("sn-kb"), true);
document.addEventListener("keydown", (e) => {
  if (!vault.fs || modalStack) return;
  const tgt = e.target;
  const inField = tgt.closest?.("input, textarea, select, [contenteditable]");
  const k = e.key.toLowerCase();
  if (isMod(e) && k === "o") { e.preventDefault(); quickOpen(); return; }
  if (isMod(e) && e.shiftKey && k === "d") { e.preventDefault(); openToday(); return; }
  if (isMod(e) && e.shiftKey && k === "k") { e.preventDefault(); board.view === "tasks" ? goBack() : openTasksView(); return; }
  if (isMod(e) && e.shiftKey && k === "f") { e.preventDefault(); setFocusMode(!UI.focus); return; }
  if (isMod(e) && e.shiftKey && (k === "t" || e.code === "KeyT")) { const ps = tagTargets(tgt); if (ps.length) { e.preventDefault(); promptAddTag(ps); } return; }
  if (isMod(e) && e.shiftKey && k === "e") { e.preventDefault(); board.view === "files" ? goBack() : openFilesView(); return; }
  if (e.key === "Escape" && UI.focus && !inField) { e.preventDefault(); setFocusMode(false); return; }
  if (isMod(e) && k === "e" && editor.path && (tgt.closest?.(".sn-editor") || !inField)) { e.preventDefault(); toggleReading(); return; }
  if ((isMod(e) && (k === "p" || k === "k")) || (e.altKey && !isMod(e) && (k === "x" || e.code === "KeyX"))) { e.preventDefault(); commandPalette(); return; }
  if (isMod(e) && k === "z" && !inField) { e.preventDefault(); undo(); return; }
  if (isMod(e) && k === "f" && !tgt.closest?.(".sn-editor")) { e.preventDefault(); toggleSearch(true); return; }
  if (isMod(e) && k === "\\") { e.preventDefault(); setSide(!UI.sideOpen); return; }
  if (inField) return;
  if (tgt.closest?.(".ag-body, .fv")) return;
  if (openMenuEl) { if (e.key === "Escape") closeMenu(); return; }
  if (tgt.closest?.(".sn-editor") || tgt.closest?.(".sn-side")) { if (e.key === "Escape" && editor.path && !tgt.closest?.(".sn-side")) closeEditor(); return; }
  const card = tgt.closest?.(".sn-card");
  if (isMod(e) && k === "a") { e.preventDefault(); $$(".sn-board .sn-rows .sn-card").forEach((c) => board.selection.add(c.dataset.path)); renderBoard(); return; }
  if (e.key === "Escape") {
    if (board.selection.size) { board.selection.clear(); renderBoard(); return; }
    if (editor.path) { closeEditor(); return; }
    if (board.searchOpen) { toggleSearch(false); return; }
    return;
  }
  if (e.key.startsWith("Arrow")) {
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); return; }
    if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); if (board.target) { const ps = graph.parentsOf(board.target).filter((p) => graph.has(p)).sort(manualCmp); setTarget(ps[0] ?? null); } return; }
    // in the list of notes → goes into a note with children and ← back out to the parent's list
    if (!board.view && !e.altKey && !isMod(e) && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      if (e.key === "ArrowLeft") leaveRow();
      else if (card?.classList.contains("has-kids")) enterRow(card.dataset.path);
      return;
    }
    const next = spatialNext(card || (lastFocused && $(`.sn-board .sn-card[data-path="${CSS.escape(lastFocused)}"]`)), e.key);
    if (next) {
      e.preventDefault(); next.focus(); next.scrollIntoView({ block: "nearest" });
      // in the list of notes the arrows page through the notes beside it (a notebook only takes the focus); on a phone a note would cover the list
      if (next.classList.contains("sn-row") && !next.classList.contains("is-folder") && innerWidth > 820 && !board.selectMode) openEditor(next.dataset.path, { focus: false, wide: false });
    }
    return;
  }
  if (card) {
    const p = card.dataset.path;
    if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey || card.classList.contains("is-folder")) enterRow(p); else openEditor(p, { focus: true, edit: true }); return; }
    if (e.key === " ") { e.preventDefault(); toggleSelect(p); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteCards(board.selection.size ? [...board.selection] : [p]); return; }
  }
  if (e.key === "?" && !card) { e.preventDefault(); hotkeysModal(); return; }
  if (e.key.length === 1 && !isMod(e) && !e.altKey && e.key !== " " && tgt.closest?.("#board, body")) {
    const ta = $(".sn-composer textarea");
    if (ta) { e.preventDefault(); ta.focus(); ta.value += e.key; ta.dispatchEvent(new Event("input")); }
  }
});

