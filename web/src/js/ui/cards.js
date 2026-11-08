/* =========================================================
   Card rendering: a card on the board, its body preview, chips and menu
   ========================================================= */
import { LANG, t, tt } from "../core/i18n.js";
import { baseName, norm, plainText } from "../core/util.js";
import { board, editor, graph, S, vault } from "../services/state.js";
import { cardIcon, linkText } from "../services/vault.js";
import { cardTaskProgress } from "../services/tasks.js";
import { attachmentUrl, firstImage } from "../services/attachments.js";
import { $, h, ic, iconBtn, isMod } from "./dom.js";
import { Menu, notice, promptModal } from "./ui.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { createCard, deleteCards, promptAddParent, promptIcon, promptMove, promptRemoveParent, promptTemplate, removeParent, setChildTemplate, templateFor, togglePin } from "./actions.js";
import { openTagView, setLastFocused, setTarget, toggleSelect } from "./board.js";
import { dnd } from "./dnd.js";
import { openEditor } from "./editor.js";

export function cardBodyText(path) { return (vault.notes.get(path)?.body || "").replace(/^\s+/, ""); }
export function formatDate(ms) {
  const diff = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
  if (diff < 60_000) return rtf.format(0, "second");
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), "hour");
  return new Date(ms).toLocaleDateString(LANG, { day: "numeric", month: "short", year: "numeric" });
}
export function parentChip(parentPath, onRemove) {
  const chip = h("a", { cls: "sn-chip", href: "#", title: parentPath });
  chip.append(ic("sn-chip-icon", cardIcon(parentPath) || "layers", "layers"), h("span", { text: baseName(parentPath) }));
  chip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (isMod(e)) openEditor(parentPath); else setTarget(parentPath); });
  if (onRemove) {
    const x = ic("sn-chip-x", "x");
    x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onRemove(); });
    chip.append(x);
  }
  return chip;
}
export function renderBody(el, path, limit) {
  let text = cardBodyText(path);
  if (!text.trim()) { el.classList.add("is-empty"); return; }
  let truncated = false;
  if (limit > 0 && text.length > limit) {
    const cut = text.lastIndexOf("\n", limit);
    text = text.slice(0, cut > limit * 0.5 ? cut : limit).trimEnd();
    truncated = true;
  }
  renderMarkdown(text, path, { into: el });
  if (truncated) el.classList.add("is-truncated");
  if (board.filter.query.trim()) highlight(el, norm(board.filter.query).split(/\s+/).filter(Boolean));
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
export function renderCard(path, via, depth = 1) {
  // "auto" follows the depth switch: one level shows whole cards, two levels compact ones, all levels titles only
  const face = S.cardFace === "auto" ? (board.depth === 0 ? "title" : board.depth >= 2 ? "compact" : "full")
    : S.cardFace === "title" || S.cardFace === "compact" ? S.cardFace : "full";
  const card = h("div", { cls: "sn-card face-" + face, tabindex: "-1" });
  card.dataset.path = path;
  card.dataset.via = via ?? "";
  card.dataset.depth = String(depth || 1);
  if (board.selection.has(path)) card.classList.add("is-picked");
  if (editor.path === path) card.classList.add("is-editing");

  const head = h("div", { cls: "sn-card-head" });
  const iconName = cardIcon(path);
  if (iconName) head.append(ic("sn-card-icon", iconName, "file-text"));
  const title = h("a", { cls: "sn-card-title", href: "#", text: baseName(path) });
  title.addEventListener("click", (e) => {
    e.preventDefault();
    if (e.shiftKey || board.selectMode) return;
    e.stopPropagation();
    if (isMod(e)) openEditor(path); else setTarget(path);
  });
  head.append(title);
  const parents = graph.parentsOf(path).filter((p) => graph.has(p));
  // a card that lives under several parents says so with a shape (as a mirror does), and lists them on a click
  if (parents.length > 1) {
    const places = h("button", { cls: "sn-places", type: "button", title: t("inPlaces", { n: parents.length }), "aria-label": t("inPlaces", { n: parents.length }) }, ic("", "copy"), h("span", { text: String(parents.length) }));
    places.addEventListener("click", (e) => { e.stopPropagation(); const m = new Menu(); for (const p of parents) m.add(baseName(p), cardIcon(p) || "file-text", (ev) => (isMod(ev) ? openEditor(p) : setTarget(p))); m.showAtEvent(e); });
    head.append(places);
  }
  // children: a board inside the card
  const kids = graph.childrenOf(path).length;
  if (kids) head.append(h("button", { cls: "sn-kids", type: "button", title: t("childCards", { n: kids }), "aria-label": t("childCards", { n: kids }), onClick: (e) => { e.stopPropagation(); setTarget(path); } }, ic("", "layers"), h("span", { text: String(kids) })));
  const add = iconBtn("plus", t("addChild"), async (e) => { e.stopPropagation(); const title = await promptModal(t("addChild") + " → " + baseName(path)); if (title) createCard(title, path); }, "sn-card-edit sn-card-add");
  const edit = iconBtn("pencil", t("edit"), (e) => { e.stopPropagation(); openEditor(path, { focus: true }); }, "sn-card-edit");
  head.append(add, edit);
  card.append(head);

  if (via && parents.includes(via)) { parents.splice(parents.indexOf(via), 1); parents.unshift(via); }
  const unresolved = graph.unresolvedParentsOf(path);
  if (parents.length || unresolved.length) {
    const chips = h("div", { cls: "sn-chips" });
    for (const p of parents) chips.append(parentChip(p));
    for (const u of unresolved) chips.append(h("span", { cls: "sn-chip is-missing", title: t("parentMissing") }, ic("sn-chip-icon", "alert-triangle"), h("span", { text: u })));
    card.append(chips);
  }

  const expanded = board.expanded.has(path);
  if (face !== "title" || expanded) {
    const body = h("div", { cls: "sn-card-body markdown-rendered" });
    wireRendered(body, path);
    const len = expanded ? 0 : face === "compact" ? (S.previewLength ? Math.min(S.previewLength, 160) : 160) : S.previewLength;
    renderBody(body, path, len);
    // a full card whose preview stops before the note's first image still shows it, small, as the notes layout does
    const img = face === "full" && !expanded && !body.querySelector("img") ? firstImage(path) : null;
    if (img) {
      const cover = h("img", { cls: "sn-card-cover", alt: "", draggable: "false", loading: "lazy" });
      attachmentUrl(img).then((u) => { cover.src = u; }).catch(() => cover.remove());
      card.append(cover);
    }
    card.append(body);
  }

  const tags = face === "title" ? [] : vault.notes.get(path)?.tags || [];
  if (tags.length) {
    const row = h("div", { cls: "sn-tags" });
    for (const tg of tags) row.append(h("span", { cls: "sn-tag", text: tg, onClick: (e) => { e.stopPropagation(); openTagView(tg); } }));
    card.append(row);
  }

  const foot = h("div", { cls: "sn-card-foot" });
  const mtime = vault.notes.get(path)?.mtime || 0;
  const prog = cardTaskProgress(path);
  foot.append(h("div", { cls: "sn-foot-meta" }, h("span", { text: formatDate(mtime), title: t("modifiedAt", { date: new Date(mtime).toLocaleString(LANG) }) }),
    prog ? h("span", { cls: "sn-task-prog" + (prog.done === prog.n ? " is-complete" : ""), title: tt("progress", prog) }, ic("", "square-check"), h("span", { text: `${prog.done}/${prog.n}` })) : null));
  const actions = h("div", { cls: "sn-foot-actions" });
  const backlinks = graph.backlinksOf(path);
  if (backlinks.length) {
    const b = h("button", { cls: "clickable-icon sn-count", type: "button", title: t("backlinks", { names: backlinks.map(baseName).join(", ") }) }, ic("", "quote"), h("span", { text: String(backlinks.length) }));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = new Menu();
      for (const p of backlinks) m.add(baseName(p), cardIcon(p) || "file-text", (ev) => (isMod(ev) ? openEditor(p) : setTarget(p)));
      m.showAtEvent(e);
    });
    actions.append(b);
  }
  actions.append(iconBtn("more-horizontal", t("more"), (e) => { e.stopPropagation(); cardMenu(path, via).showAtEvent(e); }));
  foot.append(actions);
  card.append(foot);

  card.addEventListener("contextmenu", (e) => cardMenu(path, via).showAtEvent(e));
  card.addEventListener("click", (e) => {
    if (e.target.closest("a, button, input, .sn-card-more-btn")) { if (!(e.shiftKey || board.selectMode)) return; }
    if (e.shiftKey || board.selectMode) { e.preventDefault(); toggleSelect(path); return; }
    if (getSelection()?.toString()) return;
    card.focus({ preventScroll: true });
    if (editor.path && editor.path !== path) openEditor(path, { focus: false });
  });
  card.addEventListener("dblclick", (e) => {
    if (e.target.closest("a, button, input") || e.shiftKey || board.selectMode) return;
    e.preventDefault();
    openEditor(path, { focus: true });
  });
  card.addEventListener("focus", () => setLastFocused(path));
  attachLongPress(card, (ev) => cardMenu(path, via).showAtEvent(ev));
  dnd.draggable(card, () => ({ child: path, from: via }));
  dnd.dropTarget(card, () => ({ path, parent: via }));
  return card;
}
/** A note as a row in the list of notes: where it sits and when it changed, its title, two lines of its text, its tags and the first image.
   Clicking it (or, on a wide screen, moving onto it with the arrow keys: see keyboard.js) opens it beside the list. */
export function renderRow(path, via, depth = 1) {
  const own = path === board.target && !board.tagView;
  const row = h("div", { cls: "sn-card sn-row" + (own ? " is-own" : ""), tabindex: "-1" });
  row.dataset.path = path;
  row.dataset.via = via ?? "";
  row.dataset.depth = String(depth || 1);
  if (board.selection.has(path)) row.classList.add("is-picked");
  if (editor.path === path) row.classList.add("is-editing");
  const n = vault.notes.get(path);
  const text = h("div", { cls: "sn-row-text" });

  const meta = h("div", { cls: "sn-row-meta" });
  const parents = graph.parentsOf(path).filter((p) => graph.has(p));
  const where = own ? null : via && parents.includes(via) ? via : parents.find((p) => p !== board.target) ?? null;
  if (own) meta.append(ic("sn-row-meta-icon", cardIcon(path) || "layers", "layers"), h("span", { text: t("rowOwnNote") }));
  else if (where && where !== board.target) meta.append(h("a", { cls: "sn-row-parent", href: "#", text: baseName(where), onClick: (e) => { e.preventDefault(); e.stopPropagation(); setTarget(where); } }));
  const mtime = n?.mtime || 0;
  meta.append(h("span", { cls: "sn-row-date", text: formatDate(mtime), title: t("modifiedAt", { date: new Date(mtime).toLocaleString(LANG) }) }));
  const prog = cardTaskProgress(path);
  if (prog) meta.append(h("span", { cls: "sn-task-prog" + (prog.done === prog.n ? " is-complete" : ""), title: tt("progress", prog) }, ic("", "square-check"), h("span", { text: `${prog.done}/${prog.n}` })));
  text.append(meta);

  const head = h("div", { cls: "sn-row-head" });
  const iconName = cardIcon(path);
  if (iconName && !own) head.append(ic("sn-card-icon", iconName, "file-text"));
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
    const tr = h("div", { cls: "sn-tags sn-row-tags" });
    for (const tg of tags) tr.append(h("span", { cls: "sn-tag", text: tg.replace(/^#/, ""), onClick: (e) => { e.stopPropagation(); openTagView(tg); } }));
    text.append(tr);
  }
  row.append(text);

  const img = firstImage(path);
  if (img) {
    const thumb = h("img", { cls: "sn-row-thumb", alt: "", draggable: "false" });
    attachmentUrl(img).then((u) => { thumb.src = u; }).catch(() => thumb.remove());
    row.append(thumb);
  }
  // a note with children is also a folder: the button on the right (or →) goes inside, ← comes back out
  const kids = own ? 0 : graph.childrenOf(path).length;
  if (kids) {
    row.classList.add("has-kids");
    row.append(h("button", { cls: "sn-row-enter", type: "button", title: t("rowEnter", { n: kids }), onClick: (e) => { e.stopPropagation(); enterRow(path); } },
      h("span", { text: String(kids) }), ic("", "chevron-right")));
  }

  row.addEventListener("contextmenu", (e) => cardMenu(path, via).showAtEvent(e));
  row.addEventListener("click", (e) => {
    if (e.shiftKey || board.selectMode) { e.preventDefault(); toggleSelect(path); return; }
    if (e.target.closest("a, button, input")) return;
    row.focus({ preventScroll: true });
    if (editor.path !== path || !$("#app").classList.contains("editor-open")) openEditor(path, { focus: false, wide: false });
  });
  row.addEventListener("dblclick", (e) => {
    if (e.target.closest("a, button, input") || e.shiftKey || board.selectMode) return;
    e.preventDefault();
    openEditor(path, { focus: true, wide: false });
  });
  row.addEventListener("focus", () => setLastFocused(path));
  attachLongPress(row, (ev) => cardMenu(path, via).showAtEvent(ev));
  if (!own) {
    dnd.draggable(row, () => ({ child: path, from: via }));
    dnd.dropTarget(row, () => ({ path, parent: via }));
  } else dnd.dropTarget(row, () => ({ path, parent: null, zones: ["inside"] }));
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
  if (innerWidth > 820) openEditor(from, { focus: false, wide: false });
}
export function setupClamp(card) {
  const body = $(".sn-card-body", card);
  const path = card.dataset.path;
  const max = card.classList.contains("face-compact") ? Math.min(S.cardMaxHeight || 110, 110) : S.cardMaxHeight; // a compact card keeps a few lines
  if (!body || body.classList.contains("is-empty")) return;
  const cutByLength = () => body.classList.contains("is-truncated");
  if (max <= 0 && !cutByLength()) return;
  let expanded = board.expanded.has(path);
  const btn = h("button", { cls: "sn-card-more-btn", type: "button" });
  body.after(btn);
  if (max > 0) body.style.setProperty("--sn-card-max-h", `${max}px`);
  const update = () => {
    body.classList.toggle("is-clamped", !expanded && max > 0);
    const overflow = max > 0 && body.scrollHeight > max + 8;
    const need = expanded || overflow || cutByLength();
    btn.style.display = need ? "" : "none";
    body.classList.toggle("is-faded", !expanded && (overflow || cutByLength()));
    btn.textContent = expanded ? t("showLess") : t("showMore");
  };
  btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    expanded = !expanded;
    if (expanded) board.expanded.add(path); else board.expanded.delete(path);
    if (expanded && cutByLength()) { body.classList.remove("is-truncated"); renderBody(body, path, 0); }
    update();
    if (!expanded) card.scrollIntoView({ block: "nearest" });
  });
  update();
  body.addEventListener("load", update, true);
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
  m.add(t("menuOpenOnBoard"), "layout-dashboard", () => setTarget(path));
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
  m.sep();
  m.add(S.pinned.includes(path) ? t("unpin") : t("pin"), S.pinned.includes(path) ? "pin-off" : "pin", () => togglePin(path));
  m.add(t("menuCopyLink"), "link", () => { navigator.clipboard?.writeText(`[[${linkText(path)}]]`); notice(t("linkCopied")); });
  m.sep();
  m.add(t("menuDelete"), "trash-2", () => deleteCards([path]), { warning: true });
  return m;
}

