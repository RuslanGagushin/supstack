/* =========================================================
   Board view
   ========================================================= */
import { LANG, t } from "../core/i18n.js";
import { baseName, debounce } from "../core/util.js";
import { DEPTHS, filterActive } from "../core/board-model.js";
import { board, editor, graph, S, vault } from "../services/state.js";
import { boardModel, cardIcon, cardTags, makeComparator, persistBoard } from "../services/vault.js";
import { $, $$, h, ic, iconBtn, isMod, setIcon } from "./dom.js";
import { Menu } from "./ui.js";
import { wireRendered } from "./markdown.js";
import { createCard, deleteCards, dropCards, promptAddParent, promptAddTag, promptIcon, promptMove, saveCurrentView } from "./actions.js";
import { boardResize, masonries, Masonry } from "./masonry.js";
import { cardBodyText, cardMenu, parentChip, renderBody, renderCard, renderRow, setupClamp } from "./cards.js";
import { dnd } from "./dnd.js";
import { renderTree } from "./tree.js";
import { closeEditor, openEditor } from "./editor.js";
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
  // the board's own note shows in the hero, so it isn't kept open beside it as well
  if (path && editor.path === path && !editor.wide && board.layout !== "notes") closeEditor();
  board.selection.clear();
  board.rendered = 60;
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
  // an unsent draft survives re-renders (a layout or depth button takes focus from the field), but not a move to another card
  const oldDraft = root.querySelector(".sn-composer textarea")?.value || "";
  const draft = oldDraft && composerTarget === board.target ? oldDraft : "";
  const focusSearch = active?.classList?.contains("sn-search-input") ? { pos: active.selectionStart } : null;
  const focusCard = active?.closest?.(".sn-card")?.dataset.path;

  if (board.target && !graph.has(board.target)) board.target = null;
  if (board.tagView && !board.filter.tags.includes(board.tagView)) board.tagView = null;
  const model = boardModel();
  root.className = "sn-board" + (board.layout === "list" ? " is-list" : board.layout === "notes" ? " is-notes" : "") + (board.selectMode ? " is-select-mode" : "");
  root.replaceChildren();
  masonries.length = 0;
  sentinelObs?.disconnect();

  root.append(renderToolbar());
  if (board.searchOpen) root.append(renderFilterBar(model));
  const scroll = h("div", { cls: "sn-scroll" });
  const page = h("div", { cls: "sn-page" });
  scroll.append(page);
  root.append(scroll);
  boardResize.disconnect();
  boardResize.observe(scroll);

  const notes = board.layout === "notes";
  const composer = renderComposer();
  composerTarget = board.target;
  const cards = notes ? renderRows(page, scroll, model, composer) : renderCards(page, scroll, model, composer);
  if (!notes) cards.forEach(setupClamp);
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
  board.heroSig = heroSig();
  if (board.flashPath) {
    const el = $(`.sn-card[data-path="${CSS.escape(board.flashPath)}"]`, root);
    if (el) { el.classList.add("is-new"); el.scrollIntoView({ block: "nearest" }); }
    board.flashPath = null;
  }
  if (draft && !focusComposer) { composer.input.value = draft; composer.grow(); }
  if (focusComposer) { composer.input.value = focusComposer.value; composer.input.focus(); composer.grow(); }
  else if (focusSearch) { const si = $(".sn-search-input", root); si?.focus(); si?.setSelectionRange(focusSearch.pos, focusSearch.pos); }
  else if (focusCard) $(`.sn-card[data-path="${CSS.escape(focusCard)}"]`, root)?.focus({ preventScroll: true });
  if (notes && resetScroll) openFirstNote(model);
}
/** The board as a list of notes with the open note beside it (not the agenda or the files, which have their own lists). */
export const isNotesLayout = () => board.layout === "notes" && !board.view;
/** In the list of notes, a move to another list opens its first note beside it, as a mail app does,
   unless the note already open is in the new list. On a phone the note would cover the list, so nothing opens there. */
function openFirstNote(model) {
  if (innerWidth <= 820) return;
  const inList = (p) => p === board.target || model.shown.some((c) => c.path === p);
  const keep = editor.path && inList(editor.path) ? editor.path : null;
  const path = keep || model.shown[0]?.path || (board.target && !board.tagView ? board.target : null);
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
function groupHead(b, n) {
  const headEl = h("div", { cls: "sn-group-head" });
  const title = h("a", { cls: "sn-group-title", href: "#" }, ic("sn-group-icon", cardIcon(b.head) || "layers", "layers"), h("span", { text: baseName(b.head) }));
  title.addEventListener("click", (e) => { e.preventDefault(); setTarget(b.head); });
  headEl.append(title, h("span", { cls: "sn-group-count", text: String(n) }));
  dnd.dropTarget(headEl, () => ({ path: b.head, parent: null, zones: ["inside"] }));
  return headEl;
}
/** Cards in masonry columns (or one column, for the list layout), under the board's hero. */
function renderCards(page, scroll, model, composer) {
  page.append(renderHero(model));
  const mainBlock = model.blocks[0];
  const main = new Masonry(page);
  masonries.push(main);
  main.add(composer.el);
  const cards = [];
  const addCards = (m, list) => { const start = cards.length; for (const c of list) { const el = renderCard(c.path, c.via, c.depth); m.add(el); cards.push(el); } return cards.slice(start); };
  if (model.blocks.length > 1) {
    addCards(main, mainBlock.cards);
    for (const b of model.blocks.slice(1)) {
      const g = h("div", { cls: "sn-group" });
      g.append(groupHead(b, b.cards.length - 1));
      page.append(g);
      const m = new Masonry(g);
      masonries.push(m);
      addCards(m, b.cards);
    }
  } else lazyAdd(page, scroll, mainBlock.cards, (list, later) => { const added = addCards(main, list); if (later) added.forEach(setupClamp); });
  return cards;
}
/** Notes as rows of a list: the card's own note first, then its children; each one opens beside the list. */
function renderRows(page, scroll, model, composer) {
  page.append(renderListHead(model), composer.el);
  const rows = [];
  const box = h("div", { cls: "sn-rows" });
  page.append(box);
  const addRows = (into, list) => { for (const c of list) { const el = renderRow(c.path, c.via, c.depth); into.append(el); rows.push(el); } };
  if (board.target && !board.tagView) addRows(box, [{ path: board.target, via: null, depth: 0 }]);
  const mainBlock = model.blocks[0];
  if (model.blocks.length > 1) {
    addRows(box, mainBlock.cards);
    for (const b of model.blocks.slice(1)) {
      const g = h("div", { cls: "sn-group" }, groupHead(b, b.cards.length - 1));
      const gbox = h("div", { cls: "sn-rows" });
      g.append(gbox);
      page.append(g);
      addRows(gbox, b.cards);
    }
  } else lazyAdd(page, scroll, mainBlock.cards, (list) => addRows(box, list));
  return rows;
}
/** The top of the list of notes: the card (or tag) it lists and how many notes it shows. */
function renderListHead(model) {
  const target = board.target, tv = board.tagView;
  const head = h("div", { cls: "sn-list-head" });
  head.append(h("h1", { cls: "sn-list-title" }, ic("sn-list-badge", tv ? "hash" : target ? cardIcon(target) || "layers" : "home", "layers"),
    h("span", { text: tv ? "#" + tv : target ? baseName(target) : t("allCards") })));
  head.append(h("span", { cls: "sn-list-count", text: countText(model) }));
  return head;
}
function countText(model) {
  const shown = model.shown.length, total = model.total;
  const count = total === shown && !model.active ? t("cardsCount", { n: total }) : t("cardsOf", { shown, n: total });
  const tv = board.tagView;
  const onlyTag = tv && !board.filter.query.trim() && board.filter.tags.length === 1;
  return onlyTag ? t("cardsCount", { n: shown }) : model.active ? t("filteredSuffix", { count }) : count;
}

function boardSig(model) {
  return JSON.stringify([board.target, board.depth, board.layout, board.sort, board.grouped, board.searchOpen, board.selectMode, board.filter, board.lang = LANG,
    model.blocks.map((b) => [b.head, b.cards.map((c) => `${c.path}|${c.via ?? ""}|${c.depth}`)]), model.total, model.all.skippedRepeats, model.truncated, graph.ancestry(board.target || "", makeComparator("manual"))]);
}
export function cardSig(path) {
  const n = vault.notes.get(path);
  return [n?.raw, n?.mtime, graph.childrenOf(path).length, graph.backlinksOf(path).length, graph.unresolvedParentsOf(path).join(","),
    graph.parentsOf(path).map((p) => `${p}:${cardIcon(p)}`).join(","), board.selection.has(path), editor.path === path, board.expanded.has(path)].join("\u0001");
}
function heroSig() { const p = board.target; return p ? [vault.notes.get(p)?.raw, graph.parentsOf(p).join(","), board.heroCollapsed].join("\u0001") : ""; }
/** Update the board after a note change: replace only the cards that changed, keep scroll, focus and layout. */
export function patchBoard() {
  if (board.view === "tasks") { renderBoard(); return; }
  if (board.view === "files") { if ($(".fv-list")) fvRenderList(); else renderBoard(); return; }
  const root = $("#board");
  if (!root || !root.querySelector(".sn-scroll") || board.flashPath) return renderBoard();
  if (board.target && !graph.has(board.target)) return renderBoard();
  const model = boardModel();
  if (boardSig(model) !== board.sig) return renderBoard();
  const focused = document.activeElement?.closest?.(".sn-card")?.dataset.path;
  for (const el of $$(".sn-card", root)) {
    const p = el.dataset.path;
    const sig = cardSig(p);
    if (board.cardSigs.get(p) === sig) continue;
    const fresh = (el.classList.contains("sn-row") ? renderRow : renderCard)(p, el.dataset.via || null, Number(el.dataset.depth) || 1);
    for (const m of masonries) { const i = m.items.indexOf(el); if (i >= 0) m.items[i] = fresh; }
    el.replaceWith(fresh);
    if (!fresh.classList.contains("sn-row")) setupClamp(fresh);
    board.cardSigs.set(p, sig);
    if (focused === p) fresh.focus({ preventScroll: true });
  }
  const hs = heroSig();
  if (hs !== board.heroSig) { $(".sn-hero", root)?.replaceWith(renderHero(model)); board.heroSig = hs; }
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

  const crumbs = h("div", { cls: "sn-crumbs" });
  const crumb = (path, current) => {
    const a = h("a", { cls: "sn-crumb" + (current ? " is-current" : ""), href: "#" }, ic("sn-crumb-icon", path ? cardIcon(path) || "layers" : "home", "layers"), h("span", { text: path ? baseName(path) : t("allCards") }));
    a.addEventListener("click", (e) => { e.preventDefault(); setTarget(path); });
    if (!current) dnd.dropTarget(a, () => ({ path, parent: null, zones: ["inside"], root: !path }));
    crumbs.append(a);
  };
  // at the top the hero already says "All cards": the crumbs stay empty and only hold the tools to the right
  if (target || board.tagView) crumb(null, false);
  if (board.tagView) {
    crumbs.append(h("span", { cls: "sn-crumb-sep", text: "/" }));
    crumbs.append(h("span", { cls: "sn-crumb is-current is-tag" }, ic("sn-crumb-icon", "hash"), h("span", { text: board.tagView })));
  }
  if (target) {
    for (const p of graph.ancestry(target, cmp)) { crumbs.append(h("span", { cls: "sn-crumb-sep", text: "/" })); crumb(p, false); }
    crumbs.append(h("span", { cls: "sn-crumb-sep", text: "/" }));
    crumb(target, true);
  }
  bar.append(crumbs);

  const tools = h("div", { cls: "sn-tools" });
  const seg = h("div", { cls: "sn-seg", title: t("depth") });
  for (const [v, label] of DEPTHS.map((d) => [d, d ? String(d) : "∞"])) {
    const b = h("button", { cls: "clickable-icon" + (v === board.depth ? " is-active" : ""), type: "button", text: label, title: `${t("depth")}: ${label}` });
    b.addEventListener("click", () => { board.depth = v; board.rendered = 60; persistBoard(); renderBoard(); });
    seg.append(b);
  }
  tools.append(seg);
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
  const groupToggle = () => { board.grouped = !board.grouped; persistBoard(); renderBoard(); };
  if (board.depth !== 1) {
    const gb = iconBtn("group", t("groupByParent"), groupToggle, "sn-wide-only");
    if (board.grouped) gb.classList.add("is-active");
    opts.append(gb);
  }
  const lay = h("div", { cls: "sn-seg sn-wide-only" });
  for (const [v, icn, label] of LAYOUTS()) {
    const b = iconBtn(icn, label, () => setLayout(v));
    if (v === board.layout) b.classList.add("is-active");
    lay.append(b);
  }
  tools.append(lay);
  // on a phone the layout, the sort and grouping are one "View" button (the depths and search stay in the bar)
  const curLayout = LAYOUTS().find(([v]) => v === board.layout) || LAYOUTS()[0];
  tools.append(iconBtn(curLayout[1], t("viewMenu"), (e) => {
    const m = new Menu();
    m.label(t("viewMenu"));
    for (const [v, icn, label] of LAYOUTS()) m.add(label, icn, () => setLayout(v), { checked: v === board.layout });
    m.sep(); m.label(t("sorting"));
    for (const [v, label, icn] of sortOpts) m.add(label, icn, () => { board.sort = v; persistBoard(); renderBoard(); }, { checked: v === board.sort });
    if (board.depth !== 1) { m.sep(); m.add(t("groupByParent"), "group", groupToggle, { checked: !!board.grouped }); }
    m.showBelow(e.currentTarget);
  }, "sn-narrow-only sn-view-btn"));
  bar.append(tools);
  return bar;
}
export const LAYOUTS = () => [["columns", "layout-grid", t("layoutColumns")], ["list", "rows-3", t("layoutList")], ["notes", "panel-left", t("layoutNotes")]];
export function setLayout(v) {
  if (board.layout === v) return;
  const was = board.layout;
  board.layout = v;
  persistBoard();
  // a note beside the list goes back to being a page when the list goes away
  if (was === "notes" && editor.path && !editor.wide) closeEditor();
  renderBoard(v === "notes");
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
    if (e.key === "Enter") { e.preventDefault(); $(".sn-board :is(.sn-masonry, .sn-rows) .sn-card")?.focus(); }
  });
  bar.append(h("div", { cls: "sn-search" }, ic("sn-search-icon", "search"), input));
  const scope = h("div", { cls: "sn-seg sn-scope" });
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
  for (const tg of board.filter.tags) bar.append(h("button", { cls: "clickable-icon sn-filter-chip", type: "button", onClick: () => toggleTagFilter(tg) }, h("span", { text: "#" + tg }), ic("sn-filter-chip-x", "x")));
  bar.append(h("div", { cls: "sn-spacer" }));
  if (filterActive(board.filter)) bar.append(h("button", { cls: "clickable-icon", type: "button", text: t("clear"), onClick: () => { board.filter = { query: "", tags: [], scope: board.filter.scope }; persistBoard(); renderBoard(); $(".sn-search-input")?.focus(); } }));
  bar.append(iconBtn("x", t("close"), () => toggleSearch(false)));
  return bar;
}
function renderHero(model) {
  const target = board.target;
  const hero = h("div", { cls: "sn-hero" });
  if (target) {
    dnd.dropTarget(hero, () => ({ path: target, parent: null, zones: ["inside"] }));
  }
  const tv = board.tagView;
  if (tv) hero.classList.add("is-tag");
  hero.append(ic("sn-hero-badge", tv ? "hash" : target ? cardIcon(target) || "layers" : "home", "layers"));
  hero.append(h("div", { cls: "sn-hero-title-row" }, h("h1", { cls: "sn-hero-title", text: tv ? "#" + tv : target ? baseName(target) : t("allCards") })));
  const tools = h("div", { cls: "sn-hero-tools" });
  if (target) {
    tools.append(iconBtn("pencil", t("edit"), () => openEditor(target, { focus: true })));
    tools.append(iconBtn("more-horizontal", t("more"), (e) => cardMenu(target, null).showBelow(e.currentTarget)));
    const parents = graph.parentsOf(target).filter((p) => graph.has(p));
    if (parents.length) hero.append(h("div", { cls: "sn-chips sn-hero-chips" }, parents.map((p) => parentChip(p))));
    const desc = h("div", { cls: "sn-hero-desc markdown-rendered" + (board.heroCollapsed ? " is-collapsed" : "") });
    desc.addEventListener("dblclick", (e) => { if (!e.target.closest("a, button, input")) openEditor(target, { focus: true }); });
    wireRendered(desc, target);
    renderBody(desc, target, 0);
    hero.append(desc);
  }
  hero.append(tools);
  const foot = h("div", { cls: "sn-hero-foot" });
  foot.append(h("span", { cls: "sn-hero-count", text: countText(model) }));
  if (target && cardBodyText(target).trim()) {
    const tg = iconBtn(board.heroCollapsed ? "chevron-down" : "chevron-up", board.heroCollapsed ? t("expandDescription") : t("collapseDescription"), () => {
      board.heroCollapsed = !board.heroCollapsed;
      persistBoard();
      $(".sn-hero-desc", hero)?.classList.toggle("is-collapsed", board.heroCollapsed);
      setIcon(tg, board.heroCollapsed ? "chevron-down" : "chevron-up");
    });
    foot.append(tg);
  }
  hero.append(foot);
  return hero;
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
  const btn = (icn, label, fn, warn) => { const b = h("button", { cls: "clickable-icon sn-selbar-btn" + (warn ? " is-warning" : ""), type: "button" }, ic("", icn), h("span", { text: label })); b.addEventListener("click", fn); bar.append(b); };
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

