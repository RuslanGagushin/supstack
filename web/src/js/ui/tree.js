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
import { tagsSection } from "./completion.js";

const SEP = "\u0000";
export function renderTree() {
  const host = $("#tree");
  if (!host || !vault.fs) return;
  const scroll = host.querySelector(".sn-tree")?.scrollTop || 0;
  const focusKey = host.contains(document.activeElement) ? document.activeElement.closest?.("[role=treeitem]")?.dataset.key : null;
  host.replaceChildren();
  // the tree's tools sit on its own heading ("Notebooks"), shown with the pointer over it; "New card" is the blue button above
  const header = h("div", { cls: "sn-sec-tools" });
  const sortOpts = [["manual", t("sortManual"), "list-ordered"], ["name", t("sortName"), "arrow-down-a-z"], ["modified", t("sortModified"), "clock"], ["created", t("sortCreated"), "calendar-plus"]];
  header.append(iconBtn(sortOpts.find(([v]) => v === S.outlineSort)?.[2] || "arrow-up-down", t("treeSort"), (e) => {
    const m = new Menu();
    for (const [v, label, icn] of sortOpts) m.add(label, icn, () => { S.outlineSort = v; saveSettings(); renderTree(); }, { checked: v === S.outlineSort });
    m.showBelow(e.currentTarget);
  }));
  header.append(iconBtn("crosshair", t("revealCurrent"), () => revealInTree(board.target)));
  header.append(iconBtn("chevrons-down-up", t("collapseAll"), () => { tree.expanded.clear(); persistBoard(); renderTree(); }));
  const box = h("div", { cls: "sn-tree" });
  const cmp = makeComparator(S.outlineSort);

  // the notebooks come first, right under Agenda and Files: they are where every note lives; the rest folds below them
  if (S.pinned.some((p) => graph.has(p))) {
    box.append(h("div", { cls: "sn-tree-section", text: t("pinned") }));
    const pins = S.pinned.filter((p) => graph.has(p));
    const pinTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("pinned") });
    pins.forEach((p, i) => pinTree.append(treeNode(p, [p], cmp, { pinIndex: i, pinCount: pins.length, keyPrefix: "pin" })));
    box.append(pinTree);
  }
  box.append(h("div", { cls: "sn-tree-section has-tools" }, h("span", { text: t("tree") }), header));
  const allRow = h("div", { cls: "tree-item-self is-clickable sn-tree-row" + (!board.target && !board.tagView ? " is-active" : "") }, h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", "home"), h("div", { cls: "tree-item-inner sn-tree-label", text: t("allCards") }),
    h("div", { cls: "tree-item-flair-outer" }, (() => { const n = graph.collect(null, 0, cmp).cards.length; return h("span", { cls: "tree-item-flair sn-tree-count", text: String(n), title: t("treeCountAll", { n }) }); })())); // the cards the board reaches, as its "of N" says
  allRow.addEventListener("click", () => setTarget(null));
  dnd.dropTarget(allRow, () => ({ path: null, parent: null, zones: ["inside"], root: true }));
  const nbTree = h("div", { cls: "sn-aria-tree", role: "tree", "aria-label": t("tree") });
  nbTree.append(treeItem(h("div", { cls: "tree-item" }, allRow), allRow, { key: "all", level: 1, active: !board.target && !board.tagView }));
  const roots = graph.sortedChildren(null, cmp);
  if (!roots.length) box.append(h("div", { cls: "sn-tree-empty", text: t("noCards") }));
  for (const r of roots.filter(isNotebook)) nbTree.append(treeNode(r, [r], cmp, {}));
  box.append(nbTree);
  if (S.savedViews.length) {
    box.append(h("div", { cls: "sn-tree-section", text: t("views") }));
    for (const v of S.savedViews) {
      const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row" }, h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", "bookmark"), h("div", { cls: "tree-item-inner sn-tree-label", text: v.name }));
      row.addEventListener("click", () => applyView(v));
      row.addEventListener("contextmenu", (e) => {
        const m = new Menu();
        m.add(t("rename"), "pencil", async () => { const n = await promptModal(t("viewName"), v.name); if (n) { S.savedViews = S.savedViews.map((x) => (x.id === v.id ? { ...x, name: n } : x)); await saveSettings(); renderTree(); } });
        m.add(t("deleteView"), "trash-2", async () => { S.savedViews = S.savedViews.filter((x) => x.id !== v.id); await saveSettings(); renderTree(); }, { warning: true });
        m.showAtEvent(e);
      });
      box.append(h("div", { cls: "tree-item" }, row));
    }
  }
  tagsSection(box);
  recentSection(box);
  for (const tr of box.querySelectorAll("[role=tree]")) tr.addEventListener("keydown", treeKeys);
  host.append(box);
  box.scrollTop = scroll;
  markOpenInTree();
  // one stop for Tab in each tree: the open notebook, or its first item; the arrow keys move within it (treeKeys)
  for (const tr of box.querySelectorAll("[role=tree]")) {
    const items = [...tr.querySelectorAll("[role=treeitem]")];
    (items.find((x) => x.getAttribute("aria-selected") === "true") || items[0])?.setAttribute("tabindex", "0");
  }
  if (focusKey) box.querySelector(`[role=treeitem][data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: false });
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
/** The five notes changed last. The list of All notes sorted by date shows the same, so it starts folded, last in the sidebar. */
function recentSection(box) {
  const recent = [...graph.nodes].sort((a, b) => (vault.notes.get(b)?.mtime || 0) - (vault.notes.get(a)?.mtime || 0)).slice(0, 5);
  if (recent.length <= 3) return;
  const open = UI.recentOpen === true;
  const head = h("div", { cls: "sn-tree-section is-toggle" + (open ? " is-open" : "") }, ic("sn-sec-caret", "chevron-down"), h("span", { text: t("recent") }));
  head.addEventListener("click", () => { UI.recentOpen = !open; saveUI(); renderTree(); });
  box.append(head);
  if (!open) return;
  for (const p of recent) {
    const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row is-recent" + (board.target === p ? " is-active" : "") });
    row.dataset.recent = p;
    row.append(h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", cardIcon(p) || "file-text", "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: baseName(p) }),
      h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair", text: shortAgo(vault.notes.get(p)?.mtime || 0) })));
    row.addEventListener("click", (e) => { if (isMod(e) || editor.path) openEditor(p); else setTarget(p); });
    row.addEventListener("dblclick", () => openEditor(p, { focus: true, edit: true }));
    row.addEventListener("contextmenu", (e) => cardMenu(p, null).showAtEvent(e));
    box.append(h("div", { cls: "tree-item" }, row));
  }
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
/** A notebook in the tree: it opens as the list; only the notebooks inside it are its branches, the count is every card on all levels inside. */
function treeNode(path, chain, cmp, o) {
  const key = (o.keyPrefix ? o.keyPrefix + SEP : "") + chain.join(SEP);
  const isCycle = chain.indexOf(path) !== chain.length - 1;
  const all = isCycle ? [] : graph.childrenOf(path);
  const kids = isCycle ? [] : graph.sortedChildren(path, cmp).filter(isNotebook);
  const open = !isCycle && tree.expanded.has(key) && kids.length > 0;
  const item = h("div", { cls: "tree-item" });
  const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row" + (open ? " is-open" : "") + (board.target === path ? " is-active" : "") + (isCycle ? " is-cycle" : "") });
  row.dataset.path = path;
  const toggle = h("span", { cls: "sn-tree-toggle" + (kids.length ? "" : " is-leaf") });
  setIcon(toggle, "chevron-down");
  toggle.addEventListener("click", (e) => { e.stopPropagation(); if (tree.expanded.has(key)) tree.expanded.delete(key); else tree.expanded.add(key); persistBoard(); renderTree(); });
  row.append(toggle, ic("sn-tree-icon", cardIcon(path) || (all.length ? "folder" : "file-text"), "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: baseName(path), title: isCycle ? "↻" : path }));
  // every card on all levels below, as All notes counts them: a notebook of notebooks does not read as nearly empty
  const total = all.length ? graph.collect(path, 0, cmp).cards.length : 0;
  if (total) row.append(h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair sn-tree-count", text: String(total), title: t("treeCountAll", { n: total }) })));
  row.addEventListener("click", (e) => { if (isMod(e)) openEditor(path); else setTarget(path); });
  row.addEventListener("dblclick", () => openEditor(path));
  row.addEventListener("contextmenu", (e) => {
    const m = cardMenu(path, chain.length > 1 ? chain[chain.length - 2] : null);
    if (o.pinIndex !== undefined) {
      m.sep();
      if (o.pinIndex > 0) m.add(t("moveUp"), "arrow-up", () => movePin(path, -1));
      if (o.pinIndex < o.pinCount - 1) m.add(t("moveDown"), "arrow-down", () => movePin(path, 1));
    }
    m.showAtEvent(e);
  });
  const parent = o.keyPrefix ? null : chain.length > 1 ? chain[chain.length - 2] : null;
  if (!o.keyPrefix) {
    dnd.draggable(row, () => ({ child: path, from: parent }));
    dnd.dropTarget(row, () => ({ path, parent }));
  }
  item.append(row);
  treeItem(item, row, { key, level: chain.length, expanded: kids.length ? open : null, active: board.target === path && !o.keyPrefix });
  if (open) {
    const ch = h("div", { cls: "tree-item-children sn-tree-children", role: "group" });
    for (const k of kids) ch.append(treeNode(k, [...chain, k], cmp, { keyPrefix: o.keyPrefix }));
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
