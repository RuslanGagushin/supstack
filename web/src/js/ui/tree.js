/* =========================================================
   Sidebar tree: pins, saved views and the cards' hierarchy
   ========================================================= */
import { LANG, t } from "../core/i18n.js";
import { baseName } from "../core/util.js";
import { board, editor, graph, S, tree, vault } from "../services/state.js";
import { cardIcon, makeComparator, persistBoard, saveSettings } from "../services/vault.js";
import { $, h, ic, iconBtn, isMod, setIcon } from "./dom.js";
import { Menu, promptModal } from "./ui.js";
import { applyView, createCard } from "./actions.js";
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
  host.replaceChildren();
  const header = h("div", { cls: "sn-tree-header" });
  const sortOpts = [["manual", t("sortManual"), "list-ordered"], ["name", t("sortName"), "arrow-down-a-z"], ["modified", t("sortModified"), "clock"], ["created", t("sortCreated"), "calendar-plus"]];
  header.append(iconBtn("plus-square", t("newCard"), async () => { const title = await promptModal(t("newCard")); if (title) createCard(title, board.target, "", undefined, { open: true }); }));
  header.append(iconBtn(sortOpts.find(([v]) => v === S.outlineSort)?.[2] || "arrow-up-down", t("treeSort"), (e) => {
    const m = new Menu();
    for (const [v, label, icn] of sortOpts) m.add(label, icn, () => { S.outlineSort = v; saveSettings(); renderTree(); }, { checked: v === S.outlineSort });
    m.showBelow(e.currentTarget);
  }));
  header.append(iconBtn("crosshair", t("revealCurrent"), () => revealInTree(board.target)));
  header.append(iconBtn("chevrons-down-up", t("collapseAll"), () => { tree.expanded.clear(); persistBoard(); renderTree(); }));
  const box = h("div", { cls: "sn-tree" });
  const cmp = makeComparator(S.outlineSort);

  if (S.pinned.some((p) => graph.has(p))) {
    box.append(h("div", { cls: "sn-tree-section", text: t("pinned") }));
    const pins = S.pinned.filter((p) => graph.has(p));
    pins.forEach((p, i) => box.append(treeNode(p, [p], cmp, { pinIndex: i, pinCount: pins.length, keyPrefix: "pin" })));
  }
  const recent = [...graph.nodes].sort((a, b) => (vault.notes.get(b)?.mtime || 0) - (vault.notes.get(a)?.mtime || 0)).slice(0, 5);
  if (recent.length > 3) {
    box.append(h("div", { cls: "sn-tree-section", text: t("recent") }));
    for (const p of recent) {
      const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row is-recent" + (board.target === p ? " is-active" : "") + (editor.path === p ? " is-editing" : "") },
        h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", cardIcon(p) || "file-text", "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: baseName(p) }),
        h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair", text: shortAgo(vault.notes.get(p)?.mtime || 0) })));
      row.addEventListener("click", (e) => { if (isMod(e) || editor.path) openEditor(p); else setTarget(p); });
      row.addEventListener("dblclick", () => openEditor(p, { focus: true }));
      row.addEventListener("contextmenu", (e) => cardMenu(p, null).showAtEvent(e));
      box.append(h("div", { cls: "tree-item" }, row));
    }
  }
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
  box.append(h("div", { cls: "sn-tree-section", text: t("tree") }));
  const allRow = h("div", { cls: "tree-item-self is-clickable sn-tree-row" + (!board.target && !board.tagView ? " is-active" : "") }, h("span", { cls: "sn-tree-toggle is-leaf" }), ic("sn-tree-icon", "home"), h("div", { cls: "tree-item-inner sn-tree-label", text: t("allCards") }),
    h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair sn-tree-count", text: String(graph.collect(null, 0, cmp).cards.length) }))); // the cards the board reaches, as its "of N" says
  allRow.addEventListener("click", () => setTarget(null));
  dnd.dropTarget(allRow, () => ({ path: null, parent: null, zones: ["inside"], root: true }));
  box.append(h("div", { cls: "tree-item" }, allRow));
  const roots = graph.sortedChildren(null, cmp);
  if (!roots.length) box.append(h("div", { cls: "sn-tree-empty", text: t("noCards") }));
  for (const r of roots) box.append(treeNode(r, [r], cmp, {}));
  host.append(header, box);
  box.scrollTop = scroll;
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
function treeNode(path, chain, cmp, o) {
  const key = (o.keyPrefix ? o.keyPrefix + SEP : "") + chain.join(SEP);
  const isCycle = chain.indexOf(path) !== chain.length - 1;
  const kids = isCycle ? [] : graph.sortedChildren(path, cmp);
  const open = !isCycle && tree.expanded.has(key) && kids.length > 0;
  const item = h("div", { cls: "tree-item" });
  const row = h("div", { cls: "tree-item-self is-clickable sn-tree-row" + (open ? " is-open" : "") + (board.target === path ? " is-active" : "") + (isCycle ? " is-cycle" : "") });
  row.dataset.path = path;
  const toggle = h("span", { cls: "sn-tree-toggle" + (kids.length ? "" : " is-leaf") });
  setIcon(toggle, "chevron-down");
  toggle.addEventListener("click", (e) => { e.stopPropagation(); if (tree.expanded.has(key)) tree.expanded.delete(key); else tree.expanded.add(key); persistBoard(); renderTree(); });
  row.append(toggle, ic("sn-tree-icon", cardIcon(path) || (kids.length ? "layers" : "file-text"), "file-text"), h("div", { cls: "tree-item-inner sn-tree-label", text: baseName(path), title: isCycle ? "↻" : path }));
  if (kids.length) row.append(h("div", { cls: "tree-item-flair-outer" }, h("span", { cls: "tree-item-flair sn-tree-count", text: String(kids.length) })));
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
  if (open) {
    const ch = h("div", { cls: "tree-item-children sn-tree-children" });
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
export function revealInTree(path) {
  if (!path) return;
  const cmp = makeComparator("manual");
  const chain = [...graph.ancestry(path, cmp), path];
  for (let i = 1; i < chain.length; i++) tree.expanded.add(chain.slice(0, i).join(SEP));
  persistBoard();
  setSide(true);
  renderTree();
  $(`#tree .sn-tree-row.is-active`)?.scrollIntoView({ block: "center" });
}

