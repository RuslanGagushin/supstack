/* =========================================================
   Sidebar tree: pins, saved views and the notebooks (cards that have children); a note shows in its notebook's list
   ========================================================= */
import { LANG, t } from "../core/i18n.js";
import { baseName } from "../core/util.js";
import { board, editor, graph, S, saveUI, tree, UI, vault } from "../services/state.js";
import { cardIcon, makeComparator, persistBoard, saveSettings } from "../services/vault.js";
import { $, h, ic, iconBtn, isMod, setIcon } from "./dom.js";
import { Menu, promptModal } from "./ui.js";
import { applyView } from "./actions.js";
import { cardMenu } from "./cards.js";
import { setTarget } from "./board.js";
import { dnd } from "./dnd.js";
import { openEditor } from "./editor.js";
import { setSide } from "./shell.js";
import { tagCloud, tagsSection } from "./completion.js";

const SEP = "\u0000";
/**
 * The sidebar below Agenda and Capture, in parts: pins, Notebooks, saved views, Recent and Tags. Each part is drawn from a
 * plain description of what it shows; a part whose description has not changed keeps its rows, so a save or a click on a
 * notebook (which run this) redraws only what moved. Which row is the open list is not in the descriptions: markTree sets
 * it on the rows that are there. In a big vault with every branch open, a call that changes nothing no longer rebuilds
 * some 14,000 elements and lays them out again.
 */
const parts = new Map(); // name → { sig, nodes }: the description each part was drawn from, and its nodes in the box
let treeBox = null;
export function renderTree() {
  const host = $("#tree");
  if (!host || !vault.fs) return;
  const active = document.activeElement;
  const focusKey = host.contains(active) ? active.closest?.("[role=treeitem]")?.dataset.key : null;
  if (!treeBox || treeBox.parentNode !== host) { // a new sidebar (renderAll): start over
    host.replaceChildren((treeBox = h("div", { cls: "sn-tree" })));
    parts.clear();
  }
  const cmp = makeComparator(S.outlineSort);
  const pins = S.pinned.filter((p) => graph.has(p));
  const pinModel = pins.map((p, i) => nodeModel(p, [p], cmp, { pinIndex: i, pinCount: pins.length, keyPrefix: "pin" }));
  const nbOpen = UI.notebooksOpen !== false;
  const roots = graph.sortedChildren(null, cmp);
  const nbModel = { nbOpen, sort: S.outlineSort, all: graph.countBelow(null), empty: !roots.length, roots: nbOpen ? roots.filter(isNotebook).map((r) => nodeModel(r, [r], cmp, {})) : [] };
  const views = S.savedViews.map((v) => [v.id, v.name]);
  const recent = recentModel();
  const tags = tagCloud();
  // the notebooks come first, right under Agenda and Files: they are where every note lives; the rest folds below them
  const order = [
    ["pins", pinModel, () => (pinModel.length ? pinPart(pinModel) : [])],
    ["notebooks", nbModel, () => notebooksPart(nbModel)],
    ["views", views, () => (views.length ? viewsPart() : [])],
    // Recent before Tags: the notes changed last are a quicker way back than a tag
    ["recent", recent, () => (recent ? recentPart(recent) : [])],
    ["tags", tags, () => { const f = document.createDocumentFragment(); tagsSection(f, tags); return [...f.childNodes]; }],
  ];
  let changed = false;
  for (let i = 0; i < order.length; i++) {
    const [name, model, build] = order[i];
    const sig = LANG + "\n" + JSON.stringify(model);
    const was = parts.get(name);
    if (was?.sig === sig) continue;
    changed = true;
    const nodes = build();
    for (const tr of nodes) if (tr instanceof Element && tr.matches("[role=tree]")) wireTree(tr);
    // in place of the part's old nodes, or before the first node of a part after it
    const firstOf = (n) => parts.get(n)?.nodes.find((x) => x.parentNode === treeBox);
    const anchor = was?.nodes.find((n) => n.parentNode === treeBox) || order.slice(i + 1).map(([n]) => firstOf(n)).find(Boolean) || null;
    for (const n of nodes) treeBox.insertBefore(n, anchor);
    for (const n of was?.nodes || []) n.remove();
    parts.set(name, { sig, nodes });
  }
  markTree();
  if (changed && focusKey && !treeBox.contains(document.activeElement)) treeBox.querySelector(`[role=treeitem][data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}
/** Keys, the menu key and the Tab stop of one tree. */
function wireTree(tr) {
  tr.addEventListener("keydown", treeKeys);
  tr.addEventListener("contextmenu", treeMenuKey);
  // the item focused last (by a click, or on the way back from its menu) is the tree's Tab stop
  tr.addEventListener("focusin", (e) => { if (e.target.matches?.("[role=treeitem]")) for (const x of tr.querySelectorAll("[role=treeitem]")) x.setAttribute("tabindex", x === e.target ? "0" : "-1"); });
}
/**
 * The open list on the rows that show: its row is marked (a pinned row too, though only the other trees say it is
 * selected); each tree's Tab stop is the item with focus, else the open list, else its first item; then the open note.
 */
function markTree() {
  if (!treeBox) return;
  const home = !board.target && !board.tagView;
  for (const item of treeBox.querySelectorAll("[role=treeitem]")) {
    const row = item.querySelector(":scope > .sn-tree-row"), key = item.dataset.key || "";
    const cut = key.indexOf(SEP), kind = cut < 0 ? key : key.slice(0, cut);
    let on, said;
    if (key === "all") on = said = home;
    else if (kind === "view") on = said = false;
    else if (kind === "recent") on = said = board.target === key.slice(cut + 1);
    else if (kind === "pin") { on = board.target === row?.dataset.path; said = false; }
    else on = said = board.target === row?.dataset.path;
    row?.classList.toggle("is-active", on);
    item.setAttribute("aria-selected", String(said));
  }
  for (const tr of treeBox.querySelectorAll("[role=tree]")) {
    const items = [...tr.querySelectorAll("[role=treeitem]")];
    const stop = items.find((x) => x === document.activeElement) || items.find((x) => x.getAttribute("aria-selected") === "true") || items[0];
    for (const x of items) x.setAttribute("tabindex", x === stop ? "0" : "-1");
  }
  markOpenInTree();
}
function pinPart(model) {
  const pinTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("pinned") });
  for (const m of model) pinTree.append(buildNode(m));
  return [h("div", { cls: "sn-tree-section", text: t("pinned") }), pinTree];
}
function notebooksPart(m) {
  // the tree's tools sit on its own heading ("Notebooks"), shown with the pointer over it; "New card" is the blue button above
  const header = h("div", { cls: "sn-sec-tools" });
  const sortOpts = [["manual", t("sortManual"), "list-ordered"], ["name", t("sortName"), "arrow-down-a-z"], ["modified", t("sortModified"), "clock"], ["created", t("sortCreated"), "calendar-plus"]];
  header.append(iconBtn(sortOpts.find(([v]) => v === m.sort)?.[2] || "arrow-up-down", t("treeSort"), (e) => {
    const menu = new Menu();
    for (const [v, label, icn] of sortOpts) menu.add(label, icn, () => { S.outlineSort = v; saveSettings(); renderTree(); }, { checked: v === S.outlineSort });
    menu.showBelow(e.currentTarget);
  }));
  header.append(iconBtn("crosshair", t("revealCurrent"), () => revealInTree(board.target)));
  header.append(iconBtn("chevrons-down-up", t("collapseAll"), () => { tree.expanded.clear(); persistBoard(); renderTree(); }));
  const out = [sectionHead(t("tree"), m.nbOpen, () => { UI.notebooksOpen = !m.nbOpen; saveUI(); renderTree(); }, header)];
  if (!m.nbOpen) return out;
  const allRow = h("div", { cls: "tree-item-self is-clickable sn-tree-row" }, h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", "home"), h("div", { cls: "tree-item-inner sn-tree-label", text: t("allCards") }),
    h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair sn-tree-count", text: String(m.all), title: t("treeCountAll", { n: m.all }) }))); // the cards the board reaches, as its "of N" says
  allRow.addEventListener("click", () => setTarget(null));
  dnd.dropTarget(allRow, () => ({ path: null, parent: null, zones: ["inside"], root: true }));
  const nbTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("tree") });
  nbTree.append(treeItem(h("div", { cls: "tree-item" }, allRow), allRow, { key: "all", level: 1 }));
  for (const r of m.roots) nbTree.append(buildNode(r));
  if (m.empty) out.push(h("div", { cls: "sn-tree-empty", text: t("noCards") }));
  out.push(nbTree);
  return out;
}
function viewsPart() {
  const viewTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("views") });
  for (const v of S.savedViews) {
    const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row" }, h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", "bookmark"), h("div", { cls: "tree-item-inner sn-tree-label", text: v.name }));
    row.addEventListener("click", () => applyView(v));
    row.addEventListener("contextmenu", (e) => {
      const m = new Menu();
      m.add(t("rename"), "pencil", async () => { const n = await promptModal(t("viewName"), v.name); if (n) { S.savedViews = S.savedViews.map((x) => (x.id === v.id ? { ...x, name: n } : x)); await saveSettings(); renderTree(); } });
      m.add(t("deleteView"), "trash-2", async () => { S.savedViews = S.savedViews.filter((x) => x.id !== v.id); await saveSettings(); renderTree(); }, { warning: true });
      m.showAtEvent(e);
    });
    viewTree.append(treeItem(h("div", { cls: "tree-item" }, row), row, { key: "view" + SEP + v.id, level: 1 }));
  }
  return [h("div", { cls: "sn-tree-section", text: t("views") }), viewTree];
}
/**
 * A sidebar section's heading (Notebooks, Recent, Tags), all alike: a caret and the name that fold the section, as one
 * button for the keyboard and screen readers; the tools, if any, sit beside it at the right, outside the button.
 */
export function sectionHead(label, open, onToggle, tools = null) {
  const btn = h("span", { cls: "sn-sec-btn", role: "button", tabindex: "0", "aria-expanded": String(open) }, ic("sn-sec-caret", "chevron-down"), h("span", { text: label }));
  btn.addEventListener("click", onToggle);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } });
  return h("div", { cls: "sn-tree-section is-toggle" + (open ? " is-open" : "") + (tools ? " has-tools" : "") }, btn, tools);
}
let labelIds = 0;
/**
 * A notebook as a tree item for assistive technology (spec A11Y-1): its row names it, its open state and whether it is
 * the open list are said, its notebooks are its group.
 */
function treeItem(item, row, { key, level, expanded = null, active = false }) {
  const label = row.querySelector(".sn-tree-label");
  if (label && !label.id) label.id = "tl-" + ++labelIds;
  Object.assign(item.dataset, { key });
  item.setAttribute("role", "treeitem");
  item.setAttribute("aria-level", String(level));
  item.setAttribute("aria-selected", String(!!active));
  if (label) item.setAttribute("aria-labelledby", label.id);
  if (expanded !== null) item.setAttribute("aria-expanded", String(expanded));
  item.setAttribute("tabindex", "-1");
  item._toggle = () => row.querySelector(".sn-tree-toggle:not(.is-leaf)")?.click();
  item._open = () => row.click();
  return item;
}
/**
 * The keyboard in a tree (spec A11Y-2): ↑ ↓ to the item before and after, → opens a notebook's branch or goes into it,
 * ← closes it or goes up to its notebook, Home and End to the ends, Enter or Space opens its list.
 */
function treeKeys(e) {
  const tr = e.currentTarget, cur = e.target.closest?.("[role=treeitem]");
  if (!cur || !tr.contains(cur)) return;
  const items = [...tr.querySelectorAll("[role=treeitem]")];
  const i = items.indexOf(cur), go = (el) => { if (!el) return; items.forEach((x) => x.setAttribute("tabindex", x === el ? "0" : "-1")); el.focus(); el.querySelector(".sn-tree-row")?.scrollIntoView({ block: "nearest" }); };
  const k = e.key;
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(k) || e.altKey || isMod(e)) return;
  e.preventDefault(); e.stopPropagation();
  if (k === "ArrowDown") go(items[i + 1]);
  else if (k === "ArrowUp") go(items[i - 1]);
  else if (k === "Home") go(items[0]);
  else if (k === "End") go(items[items.length - 1]);
  else if (k === "ArrowRight") { if (cur.getAttribute("aria-expanded") === "false") cur._toggle(); else if (cur.getAttribute("aria-expanded") === "true") go(cur.querySelector("[role=group] > [role=treeitem]")); }
  else if (k === "ArrowLeft") { if (cur.getAttribute("aria-expanded") === "true") cur._toggle(); else go(cur.parentElement?.closest("[role=treeitem]")); }
  else cur._open();
}
/**
 * The context-menu key (or Shift+F10) on a focused tree item: the browser aims it at the item, but each row holds its own
 * menu, so it goes on to the row, the menu opening under the row's name as it would at the pointer.
 */
function treeMenuKey(e) {
  if (!e.target.matches?.("[role=treeitem]")) return;
  const row = e.target.querySelector(":scope > .sn-tree-row");
  if (!row) return;
  e.preventDefault();
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 32, clientY: r.bottom }));
}
/** The five notes changed last, or null with fewer than four notes. The list of All notes sorted by date shows the same,
   so it starts folded, last in the sidebar; folded, its rows are left out of the description (their ages move). */
function recentModel() {
  const recent = [...graph.nodes].sort((a, b) => (vault.notes.get(b)?.mtime || 0) - (vault.notes.get(a)?.mtime || 0)).slice(0, 5);
  if (recent.length <= 3) return null;
  const open = UI.recentOpen === true;
  return { open, rows: open ? recent.map((p) => ({ p, icon: cardIcon(p) || "file-text", label: baseName(p), ago: shortAgo(vault.notes.get(p)?.mtime || 0) })) : [] };
}
function recentPart(m) {
  const out = [sectionHead(t("recent"), m.open, () => { UI.recentOpen = !m.open; saveUI(); renderTree(); })];
  if (!m.open) return out;
  const recentTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("recent") });
  for (const { p, icon, label, ago } of m.rows) {
    const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row is-recent" });
    row.dataset.recent = p;
    row.append(h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", icon, "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: label }),
      h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair", text: ago })));
    row.addEventListener("click", (e) => { if (isMod(e) || editor.path) openEditor(p); else setTarget(p); });
    row.addEventListener("dblclick", () => openEditor(p, { focus: true, edit: true }));
    row.addEventListener("contextmenu", (e) => cardMenu(p, null).showAtEvent(e));
    recentTree.append(treeItem(h("div", { cls: "tree-item" }, row), row, { key: "recent" + SEP + p, level: 1 }));
  }
  out.push(recentTree);
  return out;
}
/** Where the open note sits, when that is not the list beside it: its notebooks' rows (or its own, for a notebook's text)
   and its Recent row are marked. Called on render and whenever a note opens or closes, without redrawing the tree. */
export function markOpenInTree() {
  const host = $("#tree");
  if (!host) return;
  const p = editor.path;
  let holders = [];
  if (p && graph.has(p)) {
    const parents = graph.parentsOf(p).filter((x) => graph.has(x));
    const inList = !board.tagView && !board.view && (parents.includes(board.target) || (!board.target && !parents.length));
    if (!inList) holders = isNotebook(p) ? [p] : parents;
  }
  // a notebook in a folded branch has no row: the nearest one above it that shows takes the mark
  const shown = new Set([...host.querySelectorAll(".sn-tree-row[data-path]")].map((r) => r.dataset.path));
  const cmp = makeComparator("manual");
  const mark = new Set(holders.filter((x) => x !== board.target).map((x) => [...graph.ancestry(x, cmp), x].reverse().find((y) => shown.has(y))).filter((x) => x && x !== board.target));
  for (const row of host.querySelectorAll(".sn-tree-row[data-path]")) row.classList.toggle("is-holding", mark.has(row.dataset.path));
  for (const row of host.querySelectorAll(".sn-tree-row[data-recent]")) row.classList.toggle("is-editing", row.dataset.recent === p);
}
/** Background updates (sync, file changes) wait while the pointer is over the sidebar,
 *  so rows never move under the cursor; clicks in the sidebar still redraw at once. */
let treePending = false;
export function renderTreeSoft() {
  const side = $(".sn-side");
  if (side && side.matches(":hover") && !$("#app").classList.contains("side-closed")) {
    if (!treePending) { treePending = true; side.addEventListener("mouseleave", () => { if (treePending) { treePending = false; renderTree(); } }, { once: true }); }
    return;
  }
  treePending = false;
  renderTree();
}
function shortAgo(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return t("agoNow");
  if (d < 3600) return t("agoMin", { n: Math.round(d / 60) });
  if (d < 86400) return t("agoHour", { n: Math.round(d / 3600) });
  if (d < 86400 * 30) return t("agoDay", { n: Math.round(d / 86400) });
  return new Date(ms).toLocaleDateString(LANG, { day: "numeric", month: "short" });
}
const isNotebook = (path) => graph.childrenOf(path).length > 0;
/**
 * A notebook in the tree, as a description (what renderTree compares) and then as rows (buildNode): it opens as the list;
 * only the notebooks inside it are its branches, the count is every card on all levels inside.
 */
function nodeModel(path, chain, cmp, o) {
  const key = (o.keyPrefix ? o.keyPrefix + SEP : "") + chain.join(SEP);
  const isCycle = chain.indexOf(path) !== chain.length - 1;
  const all = isCycle ? [] : graph.childrenOf(path);
  const kids = isCycle ? [] : graph.sortedChildren(path, cmp).filter(isNotebook);
  const open = !isCycle && tree.expanded.has(key) && kids.length > 0;
  return {
    path, chain, key, isCycle, branch: kids.length > 0, open, keyPrefix: o.keyPrefix, pinIndex: o.pinIndex, pinCount: o.pinCount,
    icon: cardIcon(path) || (all.length ? "folder" : "file-text"), label: baseName(path),
    // every card on all levels below, as All notes counts them: a notebook of notebooks does not read as nearly empty
    total: all.length ? graph.countBelow(path) : 0,
    kids: open ? kids.map((k) => nodeModel(k, [...chain, k], cmp, { keyPrefix: o.keyPrefix })) : [],
  };
}
function buildNode(m) {
  const { path, chain, key } = m;
  const item = h("div", { cls: "tree-item" });
  const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row" + (m.open ? " is-open" : "") + (m.isCycle ? " is-cycle" : "") });
  row.dataset.path = path;
  const toggle = h("span", { cls: "sn-tree-toggle" + (m.branch ? "" : " is-leaf") });
  setIcon(toggle, "chevron-down");
  toggle.addEventListener("click", (e) => { e.stopPropagation(); if (tree.expanded.has(key)) tree.expanded.delete(key); else tree.expanded.add(key); persistBoard(); renderTree(); });
  row.append(toggle, ic("sn-tree-icon", m.icon, "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: m.label, title: m.isCycle ? "↻" : path }));
  if (m.total) row.append(h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair sn-tree-count", text: String(m.total), title: t("treeCountAll", { n: m.total }) })));
  row.addEventListener("click", (e) => { if (isMod(e)) openEditor(path); else setTarget(path); });
  row.addEventListener("dblclick", () => openEditor(path));
  row.addEventListener("contextmenu", (e) => {
    const menu = cardMenu(path, chain.length > 1 ? chain[chain.length - 2] : null);
    if (m.pinIndex !== undefined) {
      menu.sep();
      if (m.pinIndex > 0) menu.add(t("moveUp"), "arrow-up", () => movePin(path, -1));
      if (m.pinIndex < m.pinCount - 1) menu.add(t("moveDown"), "arrow-down", () => movePin(path, 1));
    }
    menu.showAtEvent(e);
  });
  const parent = m.keyPrefix ? null : chain.length > 1 ? chain[chain.length - 2] : null;
  if (!m.keyPrefix) {
    dnd.draggable(row, () => ({ child: path, from: parent }));
    dnd.dropTarget(row, () => ({ path, parent }));
  }
  item.append(row);
  treeItem(item, row, { key, level: chain.length, expanded: m.branch ? m.open : null });
  if (m.open) {
    const ch = h("div", { cls: "tree-item-children sn-tree-children", role: "group" });
    for (const k of m.kids) ch.append(buildNode(k));
    item.append(ch);
  }
  return item;
}
async function movePin(path, delta) {
  const list = [...S.pinned];
  const i = list.indexOf(path), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  S.pinned = list;
  await saveSettings();
  renderTree();
}
/** Open the branches down to a card's notebook, so its row shows in the tree; a note is not in the tree, its notebook is. */
export function expandTo(path) {
  if (!path || !graph.has(path)) return;
  const chain = [...graph.ancestry(path, makeComparator("manual")), path];
  if (!isNotebook(path)) chain.pop();
  for (let i = 1; i < chain.length; i++) tree.expanded.add(chain.slice(0, i).join(SEP));
}
export function revealInTree(path) {
  if (!path) return;
  expandTo(path);
  persistBoard();
  setSide(true);
  renderTree();
  $(`#tree .sn-tree-row.is-active`)?.scrollIntoView({ block: "center" });
}
