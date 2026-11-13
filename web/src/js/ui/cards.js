/* =========================================================
   Card rendering: a note as a row of the list, its parent chip and menu
   ========================================================= */
import { LANG, t, tt } from "../core/i18n.js";
import { baseName, norm, plainText } from "../core/util.js";
import { board, editor, graph, S, vault } from "../services/state.js";
import { cardIcon, linkText } from "../services/vault.js";
import { filterActive } from "../core/board-model.js";
import { cardTaskProgress } from "../services/tasks.js";
import { attachmentUrl, firstImage } from "../services/attachments.js";
import { $, $$, h, ic, isMod } from "./dom.js";
import { Menu, notice, promptModal } from "./ui.js";
import { createCard, deleteCards, promptAddParent, promptAddTag, promptIcon, promptMove, promptRemoveParent, promptTemplate, removeParent, setChildTemplate, templateFor, togglePin } from "./actions.js";
import { openTagView, setLastFocused, setTarget, toggleSelect } from "./board.js";
import { dnd } from "./dnd.js";
import { openEditor } from "./editor.js";

export function formatDate(ms) {
  const diff = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
  if (diff < 60_000) return rtf.format(0, "second");
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), "hour");
  // "23 Oct": the year only when it is not this one
  const d = new Date(ms), sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(LANG, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
export function parentChip(parentPath, onRemove) {
  const chip = h("a", { cls: "sn-chip is-s", href: "#", title: parentPath });
  chip.append(ic("sn-chip-icon", cardIcon(parentPath) || "layers", "layers"), h("span", { text: baseName(parentPath) }));
  chip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (isMod(e)) openEditor(parentPath); else setTarget(parentPath); });
  if (onRemove) {
    const x = ic("sn-chip-x", "x");
    x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onRemove(); });
    chip.append(x);
  }
  return chip;
}
function highlight(root, tokens) {
  if (!tokens.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const txt = node.nodeValue, low = norm(txt);
    const ranges = [];
    for (const w of tokens) { let i = low.indexOf(w); while (i >= 0) { ranges.push([i, i + w.length]); i = low.indexOf(w, i + w.length); } }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [a, b] of ranges) { if (a < pos) continue; frag.append(txt.slice(pos, a), h("mark", { cls: "sn-mark", text: txt.slice(a, b) })); pos = b; }
    frag.append(txt.slice(pos));
    node.replaceWith(frag);
  }
}
/** Whether `path` is a notebook (has children): it is a row of the notebooks at the top of a list. */
const isFolder = (path) => graph.childrenOf(path).length > 0;
/** A drop before or after a row reorders within its group (notebooks or notes); onto a row of the other group it can only go inside. */
function rowDrop(path, via) {
  const mine = isFolder(path);
  const same = (dnd.drag || []).every((d) => isFolder(d.child) === mine);
  return { path, parent: via, zones: same ? ["before", "inside", "after"] : ["inside"] };
}
/** A notebook as a compact row at the top of the list: its icon, its name and how many cards it holds. A click goes inside;
   a double click opens its own text. */
/**
 * The list for assistive technology (spec A11Y-1): each row is an option of the list box, named by its title and
 * selected while it is the open note or picked for select mode. Called whenever either changes.
 */
export function syncRowStates() {
  for (const c of $$("#board .sn-rows .sn-card")) c.setAttribute("aria-selected", String(c.classList.contains("is-editing") || c.classList.contains("is-picked")));
}
function asOption(row, path) {
  row.setAttribute("role", "option");
  row.setAttribute("aria-label", baseName(path));
  row.setAttribute("aria-selected", String(row.classList.contains("is-editing") || row.classList.contains("is-picked")));
  return row;
}
function renderFolderRow(path, via) {
  const row = h("div", { cls: "sn-card sn-row is-folder has-kids", tabindex: "-1" });
  row.dataset.path = path;
  row.dataset.via = via ?? "";
  if (board.selection.has(path)) row.classList.add("is-picked");
  asOption(row, path);
  if (editor.path === path) row.classList.add("is-editing");
  // a tile: its icon, its name, how many notes and notebooks are right inside it (restyle RS-26)
  const kids = graph.childrenOf(path).length;
  row.append(ic("sn-row-folder-icon", cardIcon(path) || "folder", "folder"), h("span", { cls: "sn-row-title", text: baseName(path), title: baseName(path) }),
    h("span", { cls: "sn-row-count", title: t("rowEnter", { n: kids }), text: t("cardsCount", { n: kids }) }));
  row.addEventListener("click", (e) => {
    if (e.shiftKey || board.selectMode) { e.preventDefault(); toggleSelect(path); return; }
    enterRow(path);
  });
  row.addEventListener("dblclick", (e) => {
    if (e.shiftKey || board.selectMode) return;
    e.preventDefault();
    openEditor(path, { focus: true, edit: true, wide: false });
  });
  wireRow(row, path, via);
  return row;
}
function wireRow(row, path, via) {
  row.addEventListener("contextmenu", (e) => cardMenu(path, via).showAtEvent(e));
  row.addEventListener("focus", () => setLastFocused(path));
  attachLongPress(row, (ev) => cardMenu(path, via).showAtEvent(ev));
  dnd.draggable(row, () => ({ child: path, from: via }));
  dnd.dropTarget(row, () => rowDrop(path, via));
}
/** A note as a row in the list of notes: when it changed, its title, two lines of its text, its tags and the first image; in a search
   or a tag's list also the card it sits in. Clicking it (or, on a wide screen, moving onto it with the arrow keys: see keyboard.js)
   opens it beside the list. A notebook (`folder`) is a compact row instead; the listed notebook's own text is not a row
   but the description under the list's title (board.js). */
export function renderRow(path, via, folder = false) {
  if (folder) return renderFolderRow(path, via);
  const row = h("div", { cls: "sn-card sn-row", tabindex: "-1" });
  row.dataset.path = path;
  row.dataset.via = via ?? "";
  if (board.selection.has(path)) row.classList.add("is-picked");
  if (editor.path === path) row.classList.add("is-editing");
  asOption(row, path);
  const n = vault.notes.get(path);
  const searching = !!board.tagView || filterActive(board.filter);
  const text = h("div", { cls: "sn-row-text" });

  // the title first, then its text, then one line with where it is, when it changed, its tasks and its tags (spec UI-22)
  const meta = h("div", { cls: "sn-row-meta" });
  const parents = graph.parentsOf(path).filter((p) => graph.has(p));
  const where = via && parents.includes(via) ? via : parents.find((p) => p !== board.target) ?? null;
  if (searching && where && where !== board.target) meta.append(h("a", { cls: "sn-row-parent", href: "#", text: baseName(where), onClick: (e) => { e.preventDefault(); e.stopPropagation(); setTarget(where); } }));
  const mtime = n?.mtime || 0;
  meta.append(h("span", { cls: "sn-row-date", text: formatDate(mtime), title: t("modifiedAt", { date: new Date(mtime).toLocaleString(LANG) }) }));
  const prog = cardTaskProgress(path);
  if (prog) meta.append(h("span", { cls: "sn-task-prog" + (prog.done === prog.n ? " is-complete" : ""), title: tt("progress", prog), text: t("rowTasks", prog) }));

  const head = h("div", { cls: "sn-row-head" });
  const iconName = cardIcon(path);
  if (iconName) head.append(ic("sn-card-icon", iconName, "file-text"));
  head.append(h("span", { cls: "sn-row-title", text: baseName(path) }));
  text.append(head);

  let snippet = plainText(n?.body || "", 320);
  if (board.filter.query.trim()) {
    // the match may be further in: start the preview a little before it
    const q = norm(board.filter.query).split(/\s+/).filter(Boolean)[0], full = plainText(n?.body || "", 20000), i = norm(full).indexOf(q);
    if (i > 120) snippet = "…" + full.slice(full.lastIndexOf(" ", i - 40) + 1, i + 280);
  }
  if (snippet) {
    const sn = h("div", { cls: "sn-row-snippet", text: snippet });
    if (board.filter.query.trim()) highlight(sn, norm(board.filter.query).split(/\s+/).filter(Boolean));
    text.append(sn);
  }
  const tags = n?.tags || [];
  if (tags.length) {
    const tr = h("span", { cls: "sn-tags sn-row-tags" });
    for (const tg of tags) tr.append(h("span", { cls: "sn-chip is-s is-link", text: tg.replace(/^#/, ""), onClick: (e) => { e.stopPropagation(); openTagView(tg); } }));
    meta.append(tr);
  }
  text.append(meta);
  row.append(text);

  const img = firstImage(path);
  if (img) {
    const thumb = h("img", { cls: "sn-row-thumb", alt: "", draggable: "false" });
    attachmentUrl(img).then((u) => { thumb.src = u; }).catch(() => thumb.remove());
    row.append(thumb);
  }
  // in a search a notebook is a full row too: the button on the right (or →) goes inside, ← comes back out
  const kids = graph.childrenOf(path).length;
  if (kids) {
    row.classList.add("has-kids");
    row.append(h("button", { cls: "sn-row-enter", type: "button", title: t("rowEnter", { n: kids }), onClick: (e) => { e.stopPropagation(); enterRow(path); } },
      h("span", { text: String(kids) }), ic("", "chevron-right")));
  }

  row.addEventListener("click", (e) => {
    if (e.shiftKey || board.selectMode) { e.preventDefault(); toggleSelect(path); return; }
    if (e.target.closest("a, button, input")) return;
    row.focus({ preventScroll: true });
    if (editor.path !== path || !$("#app").classList.contains("editor-open")) openEditor(path, { focus: false, wide: false });
  });
  row.addEventListener("dblclick", (e) => {
    if (e.target.closest("a, button, input") || e.shiftKey || board.selectMode) return;
    e.preventDefault();
    openEditor(path, { focus: true, edit: true, wide: false });
  });
  wireRow(row, path, via);
  return row;
}
/** Go into a note of the list of notes: list its children, with the note itself on top and its first child open beside them. */
export function enterRow(path) {
  setTarget(path);
  $(`.sn-board .sn-row[data-path="${CSS.escape(editor.path || path)}"]`)?.focus({ preventScroll: true });
}
/** Come back out to the parent's list, on the row of the card just left, which opens beside it. */
export function leaveRow() {
  const from = board.target;
  if (!from) return;
  const ps = graph.parentsOf(from).filter((p) => graph.has(p));
  setTarget(ps[0] ?? null);
  const row = $(`.sn-board .sn-row[data-path="${CSS.escape(from)}"]`);
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
  if (innerWidth > 820 && !row.classList.contains("is-folder")) openEditor(from, { focus: false, wide: false });
}
export function attachLongPress(el, open) {
  let timer = null, start = null;
  const cancel = () => { clearTimeout(timer); timer = null; start = null; };
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return cancel();
    const tc = e.touches[0];
    start = { x: tc.clientX, y: tc.clientY };
    timer = setTimeout(() => { if (start) open(new MouseEvent("contextmenu", { clientX: start.x, clientY: start.y })); timer = null; }, 550);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { const tc = e.touches[0]; if (start && tc && Math.hypot(tc.clientX - start.x, tc.clientY - start.y) > 10) cancel(); }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
}
export function cardMenu(path, via = null) {
  const m = new Menu();
  if (graph.childrenOf(path).length) m.add(t("menuOpenNotebook"), "folder-open", () => setTarget(path));
  m.add(t("menuEdit"), "pencil", () => openEditor(path));
  m.sep();
  m.add(t("menuNewChild"), "plus", async () => { const title = await promptModal(t("menuNewChild")); if (title) createCard(title, path); });
  const tpl = templateFor(path);
  m.add(tpl ? t("menuChangeTemplate", { name: baseName(tpl) }) : t("menuSetTemplate"), "layout-template", () => promptTemplate(path));
  if (tpl) m.add(t("menuRemoveTemplate"), "x", () => setChildTemplate(path, null));
  m.add(t("menuAddParent"), "git-merge", () => promptAddParent([path]));
  m.add(t("menuMoveTo"), "folder-input", () => promptMove([{ child: path, from: via ?? graph.parentsOf(path)[0] ?? null }]));
  if (via && graph.parentsOf(path).includes(via)) m.add(t("menuRemoveFrom", { name: baseName(via) }), "unlink", () => removeParent(path, via));
  else if (graph.parentsOf(path).length || graph.unresolvedParentsOf(path).length) m.add(t("menuRemoveParent"), "unlink", () => promptRemoveParent(path));
  m.add(t("menuIcon"), "smile", () => promptIcon([path]));
  m.add(t("menuAddTag"), "tag", () => promptAddTag([path]));
  m.sep();
  m.add(S.pinned.includes(path) ? t("unpin") : t("pin"), S.pinned.includes(path) ? "pin-off" : "pin", () => togglePin(path));
  m.add(t("menuCopyLink"), "link", () => { navigator.clipboard?.writeText(`[[${linkText(path)}]]`); notice(t("linkCopied")); });
  m.sep();
  m.add(t("menuDelete"), "trash-2", () => deleteCards([path]), { warning: true });
  return m;
}

