/* =========================================================
   Editor pane (the note, beside the board)
   ========================================================= */
import { t, wt } from "../core/i18n.js";
import { baseName, debounce, dirName } from "../core/util.js";
import { splitNote } from "../core/frontmatter.js";
import { on } from "../services/events.js";
import { board, editor, UI, vault } from "../services/state.js";
import { cardIcon } from "../services/vault.js";
import { writeRaw } from "../services/save.js";
import { syncHook } from "../services/sync.js";
import { $, $$, h, ic, iconBtn } from "./dom.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { promptIcon, renameCard } from "./actions.js";
import { masonries } from "./masonry.js";
import { cardMenu } from "./cards.js";
import { cardSig, setTarget } from "./board.js";
import { livePreviewExtensions, liveTa, liveText, renderLive, wireLive } from "./live-preview.js";
import { editorTable, editorTableOp, tableMenu } from "./table-editor.js";
import { editorKeys, renderEditorProps, renderEdToolbar, updateEdToolbar } from "./editor-toolbar.js";
import { downloadNote, updateFmtBar } from "./format-bar.js";
import { refresh } from "./shell.js";
import { ac, acClose, acUpdate, caretRect, outlineMenu, setFocusMode, wireEditorFiles } from "./completion.js";

export const scheduleSave = debounce(() => saveEditor(), 600);
export function openEditor(path, o = {}) {
  if (!vault.notes.has(path)) return;
  if (editor.path && editor.path !== path && editor.dirty) saveEditor();
  if (editor.path !== path) editor.propsCollapsed = true;
  // a note opens as a page in the board's place; put beside the board, it stays there for the next note until the editor closes.
  // The board's own note is never beside the board: it would show twice, in the editor and in its hero.
  if (o.wide !== undefined) editor.wide = o.wide;
  else if (!editor.path) editor.wide = board.layout !== "notes" || !!board.view;
  if (isBoardNote(path)) editor.wide = true;
  editor.path = path;
  if (editor.mode === "source" && o.keepMode !== true) editor.mode = "edit";
  $("#app").classList.add("editor-open");
  $("#app").classList.toggle("editor-wide", editor.wide);
  renderEditor();
  $$(".sn-card.is-editing").forEach((c) => c.classList.remove("is-editing"));
  $$(`.sn-card[data-path="${CSS.escape(path)}"]`).forEach((c) => { c.classList.add("is-editing"); if (c.classList.contains("sn-row")) c.scrollIntoView({ block: "nearest" }); });
  if (board.cardSigs) for (const p of [path, ...board.cardSigs.keys()]) if (board.cardSigs.has(p)) board.cardSigs.set(p, cardSig(p));
  if (o.focus === false) return;
  setTimeout(() => {
    const ta = $(".sn-editor-text");
    if (ta && editor.mode !== "read") { ta.focus(); if (!o.keepCaret) ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 0);
}
/** The note the board is showing: it opens as a page in the board's place, never beside its own hero. */
// In the list of notes there is no hero: the board's own note is a row of the list and opens beside it like the others.
export function isBoardNote(path) { return !!path && path === board.target && !board.tagView && !board.view && board.layout !== "notes"; }
export function closeEditor(force = false) {
  if (!force && editor.dirty) saveEditor();
  const was = editor.path;
  if (was && !force) setTimeout(() => $(`#board .sn-card[data-path="${CSS.escape(was)}"]`)?.focus({ preventScroll: false }), 0);
  if (force) { scheduleSave.cancel(); editor.dirty = false; }
  editor.path = null;
  editor.live = null;
  $("#app")?.classList.remove("editor-open", "editor-wide");
  $$(".sn-card.is-editing").forEach((c) => c.classList.remove("is-editing"));
  const host = $("#editor");
  if (host) host.replaceChildren();
}
export async function saveEditor() {
  scheduleSave.cancel();
  if (!editor.path || !editor.dirty) return;
  const path = editor.path;
  const n = vault.notes.get(path);
  const ta = $(".sn-editor-text");
  if (!n || (!ta && editor.mode !== "edit")) return;
  editor.dirty = false;
  editor.saving = true;
  setSaveState();
  const raw = editor.mode === "source" ? ta.value : splitNote(n.raw).fm + (editor.mode === "edit" ? liveText() : ta.value);
  try { if (raw !== n.raw) await writeRaw(path, raw, { silentEditor: true }); }
  catch { editor.dirty = true; }
  editor.saving = false;
  setSaveState();
  refresh({ keepEditor: true });
}
export function setSaveState() {
  const el = $(".sn-save-state");
  if (!el) return;
  el.textContent = editor.saving ? t("saving") : editor.dirty ? t("unsaved") : vault.fs.kind === "disk" ? t("saved") : "";
  el.classList.toggle("is-dirty", editor.dirty);
}
export function syncEditorFromDisk() {
  const ta = $(".sn-editor-text");
  const n = vault.notes.get(editor.path);
  if (!n) { renderEditor(); return; }
  if (editor.mode === "edit" && editor.live && !editor.dirty) {
    const L = editor.live;
    if (L.body !== n.body || liveText() !== n.body) {
      const lt = liveTa(), caret = lt && document.activeElement === lt ? [lt.selectionStart, lt.selectionEnd] : null;
      L.body = n.body;
      renderLive();
      if (caret) lt.setSelectionRange(...caret);
    }
  } else if (ta && !editor.dirty) {
    const want = editor.mode === "source" ? n.raw : n.body;
    if (ta.value !== want) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = want;
      try { ta.setSelectionRange(Math.min(s, want.length), Math.min(e, want.length)); } catch { /* not focused */ }
      autosize(ta);
    }
  }
  renderEditorProps();
  if (editor.mode === "read") renderEditor();
}
/** A textarea wraps all lines or none, so wide Markdown tables get no wrapping only while the caret is on a table row. */
function editorTableWrap(ta) {
  const pos = ta.selectionStart, v = ta.value;
  const line = v.slice(v.lastIndexOf("\n", pos - 1) + 1, (v.indexOf("\n", pos) + 1 || v.length + 1) - 1);
  const want = document.activeElement === ta && /^\s*\|.*\|/.test(line);
  if (want === !!ta.noWrap) return; // not the class: CodeMirror rewrites its content element's classes
  // keep the caret line where it is on screen while the text reflows
  const sc = $(".sn-editor-scroll"), before = caretRect(ta, pos).top;
  ta.noWrap = want;
  ta.classList.toggle("is-nowrap", want);
  if (ta.setWrap) ta.setWrap(!want); else ta.wrap = want ? "off" : "soft";
  autosize(ta);
  if (sc) sc.scrollTop += caretRect(ta, pos).top - before;
  if (!want) (ta.cmView?.scrollDOM || ta).scrollLeft = 0;
}
function autosize(ta) { if (ta.cmView) return; const sc = $(".sn-editor-scroll")?.scrollTop; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + ta.offsetHeight - ta.clientHeight + "px"; /* + a sideways scrollbar */ if (sc != null) $(".sn-editor-scroll").scrollTop = sc; }
export function renderEditor() {
  const host = $("#editor");
  if (!host) return;
  const path = editor.path;
  if (editor.live?.path === path && liveTa()) editor.live.body = liveText(); // unsaved typing survives a re-render
  host.replaceChildren();
  if (!path) return;
  const n = vault.notes.get(path);
  const head = h("div", { cls: "sn-editor-head" });
  head.append(iconBtn("x", t("closeEditor"), () => closeEditor()));
  const boardNote = isBoardNote(path);
  if (!boardNote) head.append(iconBtn(editor.wide ? "minimize-2" : "maximize-2", editor.wide ? t("collapseEditor") : t("expandEditor"), () => { editor.wide = !editor.wide; $("#app").classList.toggle("editor-wide", editor.wide); renderEditor(); for (const m of masonries) m.relayout(false); }, "sn-hide-narrow"));
  const crumbPath = dirName(path);
  head.append(h("div", { cls: "sn-editor-path", title: path }, crumbPath ? crumbPath + " / " : "", h("b", { text: baseName(path) })));
  head.append(h("span", { cls: "sn-save-state" }));
  if (n) {
    head.append(iconBtn("table-of-contents", wt("outline"), (e) => outlineMenu(e.currentTarget)));
    head.append(iconBtn("focus", UI.focus ? wt("focusExit") : wt("focus"), () => setFocusMode(!UI.focus), UI.focus ? "is-active" : ""));
    if (!boardNote) head.append(iconBtn("layout-dashboard", t("menuOpenOnBoard"), () => setTarget(path)));
    const modeBtn = iconBtn(editor.mode === "read" ? "pencil" : "book-open", editor.mode === "read" ? t("editingView") : t("readingView"), async () => { if (editor.dirty) await saveEditor(); editor.mode = editor.mode === "read" ? "edit" : "read"; renderEditor(); if (editor.mode === "edit") $(".sn-editor-text")?.focus(); });
    head.append(modeBtn);
    const src = iconBtn("code-2", t("sourceMode"), async () => { if (editor.dirty) await saveEditor(); editor.mode = editor.mode === "source" ? "edit" : "source"; renderEditor(); $(".sn-editor-text")?.focus(); });
    if (editor.mode === "source") src.classList.add("is-active");
    head.append(src);
    head.append(iconBtn("more-vertical", t("more"), (e) => {
      const m = cardMenu(path, null);
      if (vault.fs.kind !== "disk") m.add(t("downloadNote"), "download", () => downloadNote(path));
      m.showBelow(e.currentTarget);
    }));
  }
  host.append(head);
  if (n && editor.mode !== "read") host.append(renderEdToolbar());
  const scroll = h("div", { cls: "sn-editor-scroll" });
  scroll.addEventListener("scroll", () => { if ($(".sn-fmtbar")) updateFmtBar($(".sn-editor-text")); }, { passive: true });
  const page = h("div", { cls: "sn-editor-page" });
  scroll.append(page);
  host.append(scroll);
  if (!n) { page.append(h("div", { cls: "sn-editor-empty", text: t("noteGone") })); return; }

  if (editor.mode !== "source") {
    const badge = ic("sn-editor-badge", cardIcon(path) || "file-text", "file-text");
    if (!cardIcon(path)) badge.style.opacity = ".45";
    badge.title = t("menuIcon");
    badge.addEventListener("click", () => promptIcon([path]));
    page.append(badge);
    const title = h("textarea", { cls: "sn-inline-title", rows: "1", spellcheck: "false" });
    title.value = baseName(path);
    const growT = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
    title.addEventListener("input", growT);
    const commit = async () => { const v = title.value.replace(/\n/g, " ").trim(); if (v && v !== baseName(editor.path)) { const np = await renameCard(editor.path, v); title.value = baseName(np); renderEditor(); } else title.value = baseName(editor.path); };
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); $(".sn-editor-text")?.focus(); } if (e.key === "Escape") { e.stopPropagation(); title.value = baseName(editor.path); title.blur(); } });
    title.addEventListener("blur", commit);
    page.append(title);
    requestAnimationFrame(growT);
    if (n.fmError) page.append(h("div", { cls: "sn-fm-error", text: t("fmError", { msg: n.fmError }) }));
    page.append(h("div", { id: "editor-props" }));
  }
  if (editor.mode === "read") {
    const rd = h("div", { cls: "sn-reading markdown-rendered" });
    renderMarkdown(n.body, path, { into: rd, pdf: true });
    wireRendered(rd, path);
    rd.addEventListener("dblclick", (e) => { if (!e.target.closest("a, input")) { editor.mode = "edit"; renderEditor(); $(".sn-editor-text")?.focus(); } });
    page.append(rd);
  } else if (editor.mode === "source") {
    page.append(edDom(editorTextarea(n.raw)));
  } else {
    if (!editor.live || editor.live.path !== path || (!editor.dirty && editor.live.body !== n.body)) editor.live = { path, body: n.body };
    const box = h("div", { cls: "sn-live sn-reading markdown-rendered" });
    wireLive(box, path);
    page.append(box);
    renderLive();
  }
  page.append(h("div", { id: "editor-foot" }));
  renderEditorProps();
  setSaveState();
}
/** macOS turns -- into an em dash as you type, which breaks table separators (|---|), --- rules and frontmatter fences:
   on a line of only dashes, pipes, colons and spaces the dashes go back to hyphens. */
function undoSmartDashes(ta) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e || !/[–—]/.test(v)) return;
  const a = v.lastIndexOf("\n", s - 1) + 1, b = v.indexOf("\n", s) < 0 ? v.length : v.indexOf("\n", s);
  const line = v.slice(a, b);
  if (!/[–—]/.test(line) || !/^[\s|:\-–—]+$/.test(line)) return;
  const fix = (t) => t.replace(/—/g, "--").replace(/–/g, "-");
  ta.setRangeText(fix(line), a, b, "preserve");
  const caret = a + fix(v.slice(a, s)).length;
  ta.setSelectionRange(caret, caret);
}
/* ---------- The editor is CodeMirror 6 behind a textarea-shaped element, so the editing helpers (edInsert, autocomplete, tables, org keys…)
   keep working with value, selectionStart / selectionEnd, setSelectionRange and setRangeText. The element is the view's content, which
   holds the focus; .cmView is the view and .cmView.dom goes into the page. keydown, paste and drag events reach our listeners before
   CodeMirror's own handling (a listener that calls preventDefault keeps CodeMirror out of it), input and select come after each update. */
const cmViews = new Set();
const cmMarkdown = new CM.LanguageSupport(new CM.Language(CM.defineLanguageFacet(), CM.markdownParser.configure(CM.GFM), [], "markdown"));
function cmEditor(value, o = {}) {
  for (const v of cmViews) if (!v.dom.isConnected) { v.destroy(); cmViews.delete(v); }
  const own = { input: [], select: [], keydown: [], paste: [], drop: [], dragover: [], dragleave: [] };
  const fire = (type, e) => { for (const fn of own[type]) { fn(e); if (e.cancelBubble) break; } };
  const later = (type, from) => queueMicrotask(() => { const e = new Event(type); e.fromUser = from; fire(type, e); }); // not inside CodeMirror's update
  const wrap = new CM.Compartment();
  const view = new CM.EditorView({
    doc: value,
    extensions: [
      CM.history(),
      wrap.of(CM.EditorView.lineWrapping),
      cmMarkdown,
      CM.placeholder(o.placeholder || ""),
      CM.EditorView.contentAttributes.of({ class: "sn-editor-text" + (o.cls ? " " + o.cls : ""), spellcheck: "true", autocapitalize: "sentences" }),
      CM.Prec.highest(CM.EditorView.domEventHandlers(Object.fromEntries(["keydown", "paste", "drop", "dragover", "dragleave"].map((type) => [type, (e) => { fire(type, e); return e.defaultPrevented; }])))),
      CM.keymap.of([...CM.historyKeymap, ...CM.defaultKeymap]),
      o.extensions || [],
      CM.EditorView.updateListener.of((u) => {
        if (u.docChanged && u.transactions.some((tr) => tr.annotation(CM.Transaction.userEvent))) later("input", true);
        if (u.selectionSet) later("select");
      }),
    ],
  });
  cmViews.add(view);
  const ta = view.contentDOM, main = () => view.state.selection.main, len = () => view.state.doc.length;
  ta.cmView = view;
  Object.defineProperties(ta, {
    value: { get: () => view.state.doc.toString(), set: (v) => view.dispatch({ changes: { from: 0, to: len(), insert: v }, selection: { anchor: v.length }, annotations: CM.Transaction.addToHistory.of(false) }) },
    selectionStart: { get: () => main().from },
    selectionEnd: { get: () => main().to },
  });
  ta.setSelectionRange = (a, b = a) => view.dispatch({ selection: { anchor: Math.min(a, len()), head: Math.min(b, len()) } });
  ta.setRangeText = (text, from = main().from, to = main().to, mode = "preserve") => view.dispatch({
    changes: { from, to, insert: text },
    selection: mode === "end" ? { anchor: from + text.length } : mode === "start" ? { anchor: from } : mode === "select" ? { anchor: from, head: from + text.length } : undefined,
  });
  ta.setWrap = (on) => view.dispatch({ effects: wrap.reconfigure(on ? CM.EditorView.lineWrapping : []) });
  const add = ta.addEventListener, dispatch = ta.dispatchEvent;
  ta.addEventListener = function (type, fn, opts) { if (own[type]) own[type].push(fn); else add.call(this, type, fn, opts); };
  // our input and select events come from the update listener, not the DOM, so a dispatched one goes straight to the listeners;
  // a keydown goes through the DOM: CodeMirror dispatches its own Enter and Backspace there for Android keyboards, and its keymap has to see them
  ta.dispatchEvent = function (e) { if (e.type !== "input" && e.type !== "select") return dispatch.call(this, e); fire(e.type, e); return !e.defaultPrevented; };
  return ta;
}
/** Where an editor element goes in the page: a CodeMirror view's outer element, or the element itself. */
export const edDom = (ta) => ta.cmView?.dom || ta;
/** The editor: the whole note in source mode, the block being edited in live preview. */
export function editorTextarea(value, live = false) {
  const ta = cmEditor(value, { extensions: live ? livePreviewExtensions() : [], cls: (editor.mode === "source" ? "is-source" : "") + (live ? " is-live" : ""), placeholder: editor.mode === "source" ? t("emptyBody") : t("emptyBody") + " " + wt("slashHint") });
  ta.addEventListener("input", (e) => {
    undoSmartDashes(ta);
    editor.dirty = true; setSaveState(); autosize(ta); scheduleSave();
    syncHook("modify", editor.path, 250);
    if (e.isTrusted || e.fromUser || ac.el) acUpdate(ta);
  });
  ta.addEventListener("keydown", editorKeys);
  ta.addEventListener("blur", () => { if (editor.dirty) saveEditor(); });
  ta.addEventListener("select", () => updateFmtBar(ta));
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) updateFmtBar(null); }, 0));
  ta.addEventListener("keyup", (e) => { updateFmtBar(ta); editorTableWrap(ta); updateEdToolbar(); if (ac.el && /^(Arrow(Left|Right)|Home|End)$/.test(e.key)) acUpdate(ta); });
  ta.addEventListener("mouseup", () => { editorTableWrap(ta); updateEdToolbar(); setTimeout(() => updateFmtBar(ta), 0); });
  ta.addEventListener("input", () => { editorTableWrap(ta); updateEdToolbar(); });
  ta.addEventListener("focus", () => { editorTableWrap(ta); updateEdToolbar(); });
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) editorTableWrap(ta); }, 150));
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) acClose(); }, 120));
  wireEditorFiles(ta);
  ta.addEventListener("contextmenu", (e) => {
    // a selection keeps the system menu (copy, paste); a caret in a table gets the table menu
    if (ta.selectionStart !== ta.selectionEnd) return;
    const at = editorTable(ta);
    if (at) tableMenu((op) => editorTableOp(ta, op, at), at.row).showAtEvent(e);
  });
  requestAnimationFrame(() => autosize(ta));
  return ta;
}

// what services/ report about notes (services/events.js)
on("flush", async (path) => { if (editor.dirty && (path === undefined || editor.path === path)) await saveEditor(); });
on("written", (path, { silentEditor }) => { if (!silentEditor && editor.path === path && !editor.dirty) syncEditorFromDisk(); });
on("changed", (o) => { if (o?.disk && editor.path && !editor.dirty) syncEditorFromDisk(); });
