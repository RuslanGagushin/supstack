/* =========================================================
   Board view
   ========================================================= */
import { LANG, t } from "../core/i18n.js";
import { baseName, debounce, plainText } from "../core/util.js";
import { filterActive } from "../core/board-model.js";
import { board, editor, graph, S, vault } from "../services/state.js";
import { boardModel, cardIcon, cardTags, makeComparator, persistBoard } from "../services/vault.js";
import { $, $$, h, ic, iconBtn } from "./dom.js";
import { Menu } from "./ui.js";
import { createCard, deleteCards, dropCards, promptAddParent, promptAddTag, promptIcon, promptMove, saveCurrentView } from "./actions.js";
import { attachLongPress, cardMenu, renderRow, syncRowStates } from "./cards.js";
import { dnd } from "./dnd.js";
import { expandTo, renderTree } from "./tree.js";
import { closeEditor, openEditor, refreshNotebookPath } from "./editor.js";
import { setSide, sideToggle } from "./shell.js";
import { openTasksView, renderTasksView } from "./agenda.js";
import { fvRenderList, openFilesView, renderFilesView } from "./files.js";

export let lastFocused = null; // the card that had focus last (arrow keys go on from it)
export const setLastFocused = (path) => { lastFocused = path; };
let sentinelObs = null;
export function navEntry() {
  if (board.view === "tasks") return { tasks: true, target: board.target };
  if (board.view === "files") return { files: true, target: board.target };
  return board.tagView ? { tag: board.tagView } : board.target;
}
export function leaveTagView() {
  if (!board.tagView) return;
  board.tagView = null;
  board.filter = { query: "", tags: [], scope: "here" };
  board.searchOpen = false;
}
/** Open a tag as its own view: every card with the tag, from the whole vault. */
export function openTagView(tag, push = true) {
  tag = String(tag).replace(/^#/, "").toLowerCase();
  if (board.tagView === tag) { $("#board")?.querySelector(".sn-scroll")?.scrollTo({ top: 0 }); return; }
  if (push) board.history.push(navEntry());
  if (board.history.length > 100) board.history.shift();
  board.tagView = tag;
  board.view = null;
  board.target = null;
  board.filter = { query: "", tags: [tag], scope: "all" };
  board.searchOpen = false;
  board.selection.clear();
  board.rendered = 60;
  persistBoard();
  renderBoard(true);
  renderTree();
  if (innerWidth <= 820) setSide(false);
}
export function setTarget(path, push = true) {
  if (path && !graph.has(path)) path = null;
  if (path === board.target && !board.tagView && !board.view) { $("#board")?.querySelector(".sn-scroll")?.scrollTo({ top: 0 }); return; }
  if (push) board.history.push(navEntry());
  leaveTagView();
  board.view = null;
  if (board.history.length > 100) board.history.shift();
  board.target = path;
  board.selection.clear();
  board.rendered = 60;
  expandTo(path); // the sidebar shows where the list is, however it was reached
  persistBoard();
  renderBoard(true);
  renderTree();
  if (innerWidth <= 820) setSide(false);
}
export function goBack() {
  if (!board.history.length) return;
  const p = board.history.pop();
  if (p && typeof p === "object" && p.tasks) { board.target = p.target ?? null; openTasksView(false); }
  else if (p && typeof p === "object" && p.files) { board.target = p.target ?? null; openFilesView(false); }
  else if (p && typeof p === "object") openTagView(p.tag, false);
  else { if (board.view && p === board.target) { board.view = null; persistBoard(); renderBoard(true); renderTree(); return; } setTarget(p, false); }
}
export function toggleSelect(path) {
  if (board.selection.has(path)) board.selection.delete(path); else board.selection.add(path);
  $$(`.sn-card`, $("#board")).forEach((c) => c.classList.toggle("is-picked", board.selection.has(c.dataset.path)));
  syncRowStates();
  renderSelbar();
}
function toggleTagFilter(tag) {
  const tags = new Set(board.filter.tags);
  if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
  board.filter.tags = [...tags];
  board.searchOpen = true;
  persistBoard();
  renderBoard();
}

export function renderBoard(resetScroll = false) {
  const root = $("#board");
  if (!root || !vault.fs) return;
  $("#files-btn")?.classList.toggle("is-active", board.view === "files");
  $("#app")?.classList.toggle("notes-layout", isNotesLayout());
  if (board.view === "tasks") { renderTasksView(root); return; }
  if (board.view === "files") { renderFilesView(root); return; }
  const oldScroll = root.querySelector(".sn-scroll");
  const scrollTop = resetScroll ? 0 : oldScroll?.scrollTop || 0;
  const active = document.activeElement;
  const focusComposer = active?.closest?.(".sn-composer") ? { value: active.value } : null;
  // an unsent draft survives re-renders (a sort button takes focus from the field), but not a move to another card
  const oldDraft = root.querySelector(".sn-composer textarea")?.value || "";
  const draft = oldDraft && composerTarget === board.target ? oldDraft : "";
  const focusSearch = active?.classList?.contains("sn-search-input") ? { pos: active.selectionStart } : null;
  const focusCard = active?.closest?.(".sn-card")?.dataset.path;

  if (board.target && !graph.has(board.target)) board.target = null;
  if (board.tagView && !board.filter.tags.includes(board.tagView)) board.tagView = null;
  const model = boardModel();
  root.className = "sn-board is-notes" + (board.selectMode ? " is-select-mode" : "");
  root.replaceChildren();
  sentinelObs?.disconnect();

  root.append(renderToolbar());
  if (board.searchOpen) root.append(renderFilterBar(model));
  const scroll = h("div", { cls: "sn-scroll" });
  const page = h("div", { cls: "sn-page" });
  scroll.append(page);
  root.append(scroll);

  const composer = renderComposer();
  composerTarget = board.target;
  // while searching or in a tag's view it would be unclear where a new note goes: no field there
  composer.el.hidden = model.active || !!board.tagView;
  const cards = renderRows(page, scroll, model, composer);
  if (!model.shown.length) page.append(h("div", { cls: "sn-empty", text: model.active ? t("noMatches") : t("noCards") }));
  const footnotes = [];
  if (model.all.skippedRepeats && !model.active) footnotes.push(t("repeatsSkipped", { n: model.all.skippedRepeats }));
  if (model.truncated) footnotes.push(t("truncatedNote", { n: S.maxCards }));
  if (footnotes.length) page.append(h("div", { cls: "sn-footnote", text: footnotes.join(" · ") }));
  root.append(h("div", { id: "selbar-host" }));
  board.lastModel = model;
  renderSelbar();
  scroll.scrollTop = scrollTop;

  board.sig = boardSig(model);
  board.cardSigs = new Map(cards.map((el) => [el.dataset.path, cardSig(el.dataset.path)]));
  if (board.flashPath) {
    const el = $(`.sn-card[data-path="${CSS.escape(board.flashPath)}"]`, root);
    if (el) { el.classList.add("is-new"); el.scrollIntoView({ block: "nearest" }); }
    board.flashPath = null;
  }
  if (draft && !focusComposer) { composer.input.value = draft; composer.grow(); }
  if (focusComposer) { composer.input.value = focusComposer.value; composer.input.focus(); composer.grow(); }
  else if (focusSearch) { const si = $(".sn-search-input", root); si?.focus(); si?.setSelectionRange(focusSearch.pos, focusSearch.pos); }
  else if (focusCard) $(`.sn-card[data-path="${CSS.escape(focusCard)}"]`, root)?.focus({ preventScroll: true });
  if (resetScroll) openFirstNote(model);
  refreshNotebookPath();
}
/** The board as a list of notes with the open note beside it (not the agenda or the files, which have their own lists). */
export const isNotesLayout = () => !board.view;
/** In the list of notes, a move to another list opens its first note (not a notebook) beside it, as a mail app does,
   unless the note already open is in the new list; with no notes, the card's own text if it has any.
   On a phone the note would cover the list, so nothing opens there. */
function openFirstNote(model) {
  if (innerWidth <= 820) return;
  const inList = (p) => p === board.target || model.shown.some((c) => c.path === p);
  const keep = editor.path && inList(editor.path) ? editor.path : null;
  const own = board.target && !board.tagView && hasText(board.target) ? board.target : null;
  const path = keep || model.shown.find((c) => !c.folder)?.path || own;
  if (!path) { if (editor.path && editor.wide) closeEditor(); return; }
  if (path === editor.path && !editor.wide) return;
  openEditor(path, { focus: false, wide: false });
}
/** Lay out a long list a part at a time: the first part now, the rest as the page scrolls near its end. */
function lazyAdd(page, scroll, list, add) {
  const first = Math.min(list.length, Math.max(60, board.rendered));
  add(list.slice(0, first));
  let done = first;
  if (done >= list.length) return;
  const sentinel = h("div", { cls: "sn-sentinel" });
  page.append(sentinel);
  sentinelObs = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    const next = list.slice(done, done + 40);
    add(next, true);
    done += next.length;
    board.rendered = done;
    if (done >= list.length) { sentinelObs.disconnect(); sentinel.remove(); }
  }, { root: scroll, rootMargin: "600px" });
  sentinelObs.observe(sentinel);
}
/** Most notebooks are empty headings; the ones with text of their own show it under the list's title. */
const hasText = (path) => !!vault.notes.get(path)?.body?.trim();
const descText = (path) => plainText(vault.notes.get(path)?.body || "", 400);
/** Notes as rows of a list: its notebooks, then its notes; a note opens beside the list. The notebook's own text is not a row
   but its description, under the title. */
function renderRows(page, scroll, model, composer) {
  page.append(renderListHead(model));
  if (board.target && !board.tagView && hasText(board.target)) page.append(renderListDesc(board.target));
  page.append(composer.el);
  const rows = [];
  // a list box of notes, named as the list's title says (spec A11Y-1)
  const listName = board.tagView ? "#" + board.tagView : board.target ? baseName(board.target) : t("allCards");
  const box = h("div", { cls: "sn-rows", role: "listbox", "aria-label": listName, "aria-multiselectable": String(!!board.selectMode) });
  page.append(box);
  const addRows = (list) => { for (const c of list) { const el = renderRow(c.path, c.via, !!c.folder); box.append(el); rows.push(el); } };
  lazyAdd(page, scroll, model.shown, addRows);
  return rows;
}
/** The top of the list of notes: the card (or tag) it lists and how many notebooks and notes it shows. */
function renderListHead(model) {
  const target = board.target, tv = board.tagView;
  const head = h("div", { cls: "sn-list-head" });
  head.append(h("h1", { cls: "sn-list-title" }, ic("sn-list-badge", tv ? "hash" : target ? cardIcon(target) || "layers" : "home", "layers"),
    h("span", { text: tv ? "#" + tv : target ? baseName(target) : t("allCards") })));
  head.append(h("span", { cls: "sn-list-count", text: countText(model) }));
  return head;
}
/** The notebook's own text, three lines of it: a click opens it beside the list, a double click (or Enter) to edit. */
function renderListDesc(path) {
  const el = h("div", { cls: "sn-list-desc" + (editor.path === path ? " is-editing" : ""), tabindex: "0", role: "button", title: t("listDescOpen") },
    h("span", { cls: "sn-list-desc-text", text: descText(path) }));
  el.dataset.path = path;
  el.addEventListener("click", () => openEditor(path, { focus: false, wide: false }));
  el.addEventListener("dblclick", () => openEditor(path, { focus: true, edit: true, wide: false }));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); openEditor(path, { focus: true, edit: true, wide: false }); } });
  el.addEventListener("contextmenu", (e) => cardMenu(path, null).showAtEvent(e));
  attachLongPress(el, (ev) => cardMenu(path, null).showAtEvent(ev));
  dnd.dropTarget(el, () => ({ path, parent: null, zones: ["inside"] })); // a note dropped on it goes into this notebook
  return el;
}
/** What the list holds: "1 notebook · 2 notes" at its own level; with a filter, in a tag's list or cut short, how many of how many. */
function countText(model) {
  const shown = model.shown.length, total = model.total;
  const tv = board.tagView;
  const onlyTag = tv && !board.filter.query.trim() && board.filter.tags.length === 1;
  if (onlyTag) return t("cardsCount", { n: shown });
  if (!model.active && !tv && !model.truncated) {
    const books = model.shown.filter((c) => c.folder).length, notes = shown - books;
    return [books ? t("notebooksCount", { n: books }) : "", notes || !books ? t("cardsCount", { n: notes }) : ""].filter(Boolean).join(" · ");
  }
  const count = total === shown && !model.active ? t("cardsCount", { n: total }) : t("cardsOf", { shown, n: total });
  return model.active ? t("filteredSuffix", { count }) : count;
}

function boardSig(model) {
  return JSON.stringify([board.target, board.sort, board.searchOpen, board.selectMode, board.filter, board.lang = LANG,
    model.shown.map((c) => `${c.path}|${c.via ?? ""}|${c.folder ? 1 : 0}`), hasText(board.target || ""), model.total, model.all.skippedRepeats, model.truncated, graph.ancestry(board.target || "", makeComparator("manual"))]);
}
export function cardSig(path) {
  const n = vault.notes.get(path);
  return [n?.raw, n?.mtime, graph.childrenOf(path).length, graph.backlinksOf(path).length, graph.unresolvedParentsOf(path).join(","),
    graph.parentsOf(path).map((p) => `${p}:${cardIcon(p)}`).join(","), board.selection.has(path), editor.path === path].join("\u0001");
}
/** Update the board after a note change: replace only the rows that changed, keep scroll and focus. */
export function patchBoard() {
  if (board.view === "tasks") { renderBoard(); return; }
  if (board.view === "files") { if ($(".fv-list")) fvRenderList(); else renderBoard(); return; }
  const root = $("#board");
  if (!root || !root.querySelector(".sn-scroll") || board.flashPath) return renderBoard();
  if (board.target && !graph.has(board.target)) return renderBoard();
  const model = boardModel();
  if (boardSig(model) !== board.sig) return renderBoard();
  // the notebook's own text, as it is being written beside the list
  const desc = $(".sn-list-desc-text", root);
  if (desc && board.target) { const d = descText(board.target); if (desc.textContent !== d) desc.textContent = d; }
  const focused = document.activeElement?.closest?.(".sn-card")?.dataset.path;
  for (const el of $$(".sn-card", root)) {
    const p = el.dataset.path;
    const sig = cardSig(p);
    if (board.cardSigs.get(p) === sig) continue;
    const fresh = renderRow(p, el.dataset.via || null, el.classList.contains("is-folder"));
    el.replaceWith(fresh);
    board.cardSigs.set(p, sig);
    if (focused === p) fresh.focus({ preventScroll: true });
  }
  board.lastModel = model;
}
function renderToolbar() {
  const bar = h("div", { cls: "sn-topbar" });
  const cmp = makeComparator("manual");
  const nav = h("div", { cls: "sn-nav" });
  const backBtn = iconBtn("arrow-left", t("back"), () => goBack());
  backBtn.disabled = !board.history.length;
  const target = board.target;
  const parents = target ? graph.parentsOf(target).filter((p) => graph.has(p)).sort((a, b) => cmp(a, b)) : [];
  const upBtn = iconBtn("arrow-up", t("toParent"), (e) => {
    if (!target) return;
    if (parents.length <= 1) return setTarget(parents[0] ?? null);
    const m = new Menu();
    for (const p of parents) m.add(baseName(p), cardIcon(p) || "layers", () => setTarget(p));
    m.showBelow(e.currentTarget);
  });
  // the sidebar's opener (only while it is closed), then only the moves that can be made
  nav.append(sideToggle());
  if (board.history.length) nav.append(backBtn);
  if (target) nav.append(upBtn);
  bar.append(nav);

  // no breadcrumbs: the list's title says where it is, ↑ goes up, and the open note's header has the whole path (editor.js);
  // the empty space only pushes the tools to the right
  bar.append(h("div", { cls: "sn-crumbs" }));

  const tools = h("div", { cls: "sn-tools" });
  const sb = iconBtn("search", t("searchAndFilters"), () => toggleSearch());
  if (filterActive(board.filter)) sb.classList.add("is-active");
  tools.append(sb);
  const sel = iconBtn("check-square", board.selectMode ? t("selectModeOff") : t("selectMode"), () => { board.selectMode = !board.selectMode; if (!board.selectMode) board.selection.clear(); renderBoard(); }, "sn-desktop-optional sn-hide-narrow");
  if (board.selectMode) sel.classList.add("is-active");
  tools.append(sel);
  tools.append(iconBtn("bookmark-plus", t("saveView"), () => saveCurrentView(), "sn-hide-narrow"));
  // sort and grouping are plain icons, not another grey pill; grouping shows only where it can work
  const opts = tools;
  const sortOpts = [["manual", t("sortManual"), "list-ordered"], ["name", t("sortName"), "arrow-down-a-z"], ["modified", t("sortModified"), "clock"], ["created", t("sortCreated"), "calendar-plus"]];
  opts.append(iconBtn(sortOpts.find(([v]) => v === board.sort)?.[2] || "arrow-up-down", t("sorting"), (e) => {
    const m = new Menu();
    for (const [v, label, icn] of sortOpts) m.add(label, icn, () => { board.sort = v; persistBoard(); renderBoard(); }, { checked: v === board.sort });
    m.showBelow(e.currentTarget);
  }, "sn-wide-only"));
  // on a phone the sort is one "View" button (search stays in the bar)
  tools.append(iconBtn("sliders-horizontal", t("viewMenu"), (e) => {
    const m = new Menu();
    m.label(t("sorting"));
    for (const [v, label, icn] of sortOpts) m.add(label, icn, () => { board.sort = v; persistBoard(); renderBoard(); }, { checked: v === board.sort });
    m.showBelow(e.currentTarget);
  }, "sn-narrow-only sn-view-btn"));
  bar.append(tools);
  return bar;
}
export function toggleSearch(open) {
  board.searchOpen = open ?? !board.searchOpen;
  if (!board.searchOpen) board.filter = { query: "", tags: [] };
  persistBoard();
  renderBoard();
  if (board.searchOpen) $(".sn-search-input")?.focus();
}
const applyQuery = debounce(() => { persistBoard(); renderBoard(); }, 160);
function renderFilterBar(model) {
  const bar = h("div", { cls: "sn-filterbar" });
  const input = h("input", { cls: "sn-search-input", type: "text", placeholder: t("searchPlaceholder"), value: board.filter.query, spellcheck: "false" });
  input.addEventListener("input", () => { board.filter.query = input.value; applyQuery(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ""; board.filter.query = ""; applyQuery(); } else toggleSearch(false); }
    if (e.key === "Enter") { e.preventDefault(); $(".sn-board .sn-rows .sn-card")?.focus(); }
  });
  bar.append(h("div", { cls: "sn-search" }, ic("sn-search-icon", "search"), input));
  const scope = h("div", { cls: "sn-seg is-s sn-scope" });
  for (const [v, label] of [["here", t("scopeHere")], ["all", t("scopeAll")]]) {
    const cur = board.filter.scope === "all" ? "all" : "here";
    const b = h("button", { cls: "clickable-icon" + (cur === v ? " is-active" : ""), type: "button", text: label });
    b.addEventListener("click", () => { board.filter.scope = v; persistBoard(); renderBoard(); $(".sn-search-input")?.focus(); });
    scope.append(b);
  }
  bar.append(scope);
  const tagCounts = new Map();
  for (const c of model.all.cards) for (const tg of cardTags(c.path)) tagCounts.set(tg, (tagCounts.get(tg) || 0) + 1);
  const tb = h("button", { cls: "clickable-icon sn-filter-btn" + (board.filter.tags.length ? " is-active" : ""), type: "button" }, ic("", "tag"), h("span", { text: t("tags") }));
  if (!tagCounts.size && !board.filter.tags.length) tb.disabled = true;
  tb.addEventListener("click", (e) => {
    const m = new Menu();
    if (!tagCounts.size) m.add(t("noTags"), null, null, { disabled: true });
    for (const [tg, n] of [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) m.add(`#${tg}  ·  ${n}`, "hash", () => toggleTagFilter(tg), { checked: board.filter.tags.includes(tg) });
    m.showBelow(e.currentTarget);
  });
  bar.append(tb);
  for (const tg of board.filter.tags) bar.append(h("button", { cls: "sn-chip sn-filter-chip", type: "button", onClick: () => toggleTagFilter(tg) }, h("span", { text: "#" + tg }), ic("sn-filter-chip-x", "x")));
  bar.append(h("div", { cls: "sn-spacer" }));
  if (filterActive(board.filter)) bar.append(h("button", { cls: "clickable-icon", type: "button", text: t("clear"), onClick: () => { board.filter = { query: "", tags: [], scope: board.filter.scope }; persistBoard(); renderBoard(); $(".sn-search-input")?.focus(); } }));
  bar.append(iconBtn("x", t("close"), () => toggleSearch(false)));
  return bar;
}
let composerTarget = null;
function renderComposer() {
  const box = h("div", { cls: "sn-composer" });
  const ta = h("textarea", { rows: "1", placeholder: t("composerPlaceholder") });
  box.append(ta, h("div", { cls: "sn-composer-hint", text: t("composerHint") }));
  const grow = () => { ta.style.height = ""; if (ta.value) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; } };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { ta.value = ""; grow(); ta.blur(); $("#board").focus(); return; }
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    const [first, ...rest] = text.split("\n");
    ta.value = ""; grow();
    createCard(first, board.target, rest.join("\n").trim(), undefined, { tags: board.tagView ? [board.tagView] : [] }).then(() => setTimeout(() => $(".sn-composer textarea")?.focus(), 0));
  });
  return { el: box, input: ta, grow };
}
function renderSelbar() {
  const host = $("#selbar-host");
  if (!host) return;
  host.replaceChildren();
  const sel = [...board.selection].filter((p) => graph.has(p));
  if (!sel.length) return;
  const bar = h("div", { cls: "sn-selbar" }, h("span", { cls: "sn-selbar-count", text: t("selected", { n: sel.length }) }));
  const btn = (icn, label, fn, warn) => { const b = h("button", { cls: "clickable-icon sn-selbar-btn" + (warn ? " is-warn" : ""), type: "button" }, ic("", icn), h("span", { text: label })); b.addEventListener("click", fn); bar.append(b); };
  const viaOf = (p) => $(`.sn-card[data-path="${CSS.escape(p)}"]`)?.dataset.via || null;
  btn("smile", t("icon"), () => promptIcon(sel));
  btn("tag", t("selAddTag"), () => promptAddTag(sel));
  btn("git-merge", t("selAddParent"), () => promptAddParent(sel));
  btn("folder-input", t("selMove"), () => promptMove(sel.map((p) => ({ child: p, from: viaOf(p) }))));
  if (board.target) btn("unlink", t("selRemoveFrom"), () => dropCards(sel.filter((p) => graph.parentsOf(p).includes(board.target)).map((p) => ({ child: p, from: board.target })), null, true, null));
  btn("trash-2", t("selDelete"), () => deleteCards(sel), true);
  bar.append(iconBtn("x", t("selClear"), () => { board.selection.clear(); renderBoard(); }));
  host.append(bar);
}

