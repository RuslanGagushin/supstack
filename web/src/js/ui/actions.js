/* =========================================================
   Card actions: create, link to parents, move, color, icon, template, delete, rename, pins and views
   ========================================================= */
import { t } from "../core/i18n.js";
import { baseName, dirName } from "../core/util.js";
import { composeBody, dumpYaml, extractLinkpath, fillTemplate, parentLinkpaths, TEMPLATE_SKIP_KEYS, toStringList } from "../core/frontmatter.js";
import { reorderBlock } from "../core/graph.js";
import { board, editor, graph, PARENTS_FIELD, S, tree, vault } from "../services/state.js";
import { CARDS, inFolder, vaultFolder } from "../services/folders.js";
import { cardIcon, indexNames, linkText, manualCmp, parseNote, persistBoard, resolveLink, saveSettings } from "../services/vault.js";
import { removeNote, txn, updateFM, writeRaw } from "../services/save.js";
import { syncHook } from "../services/sync.js";
import { confirmModal, iconModal, notice, promptModal, suggestModal } from "./ui.js";
import { renderBoard, setTarget } from "./board.js";
import { renderTree } from "./tree.js";
import { closeEditor, openEditor, saveEditor } from "./editor.js";
import { refresh } from "./shell.js";

export const sanitizeTitle = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
function uniquePath(folder, title) {
  const base = (folder ? folder + "/" : "") + title;
  let p = base + ".md", i = 1;
  const taken = (x) => vault.allPaths.has(x) || [...vault.allPaths].some((y) => y.toLowerCase() === x.toLowerCase());
  while (taken(p)) p = `${base} ${i++}.md`;
  return p;
}
export function templateFor(path) {
  const lp = parentLinkpaths(vault.notes.get(path)?.fm?.child_template)[0];
  return lp ? resolveLink(lp, path) : null;
}
export async function createCard(title, parentPath, body = "", templatePath = undefined, { open = false, tags = [] } = {}) {
  const field = PARENTS_FIELD;
  const clean = sanitizeTitle(title) || t("untitled");
  // in cards/, next to its parent when the parent is there too
  const folder = parentPath && inFolder(parentPath, CARDS) ? dirName(parentPath) : vaultFolder(CARDS);
  const path = uniquePath(folder, clean);
  let fm = {}, tplBody = "";
  const tpl = templatePath === undefined ? (parentPath ? templateFor(parentPath) : null) : templatePath;
  const now = new Date();
  if (tpl && vault.notes.has(tpl)) {
    const tn = vault.notes.get(tpl);
    for (const [k, v] of Object.entries(tn.fm)) {
      if (TEMPLATE_SKIP_KEYS.has(k) || k === field) continue;
      fm[k] = typeof v === "string" ? fillTemplate(v, clean, now) : structuredClone(v);
    }
    tplBody = fillTemplate(tn.body, clean, now);
  }
  if (parentPath) fm = { [field]: [`[[${linkText(parentPath)}]]`], ...fm };
  if (tags.length) fm.tags = [...new Set([...toStringList(fm.tags), ...tags])];
  const raw = (Object.keys(fm).length ? "---\n" + dumpYaml(fm) + "---\n" : "") + composeBody(tplBody, body);
  await txn(null, async () => { await writeRaw(path, raw); return t("cardCreated", { name: baseName(path) }); });
  board.flashPath = path;
  if (open) openEditor(path, { focus: true });
  return path;
}
export async function addParent(child, parent) {
  if (child === parent) return notice(t("selfParent"));
  if (graph.isDescendant(child, parent)) return notice(t("cannotNest", { child: baseName(child), parent: baseName(parent) }));
  if (graph.parentsOf(child).includes(parent)) return notice(t("alreadyParent", { parent: baseName(parent) }));
  const field = PARENTS_FIELD;
  await txn(t("parentAdded", { name: baseName(parent) }), () => updateFM(child, (fm) => {
    const list = toStringList(fm[field]);
    list.push(`[[${linkText(parent)}]]`);
    fm[field] = list;
  }));
}
function withoutParent(list, child, parentPath) {
  return list.filter((entry) => {
    const lp = extractLinkpath(entry);
    if (!lp) return true;
    const dest = resolveLink(lp, child);
    return dest ? dest !== parentPath : lp !== parentPath;
  });
}
export async function removeParent(child, parentPathOrLinkpath) {
  const field = PARENTS_FIELD;
  await txn(t("parentRemoved", { name: baseName(parentPathOrLinkpath) }), () => updateFM(child, (fm) => {
    const list = withoutParent(toStringList(fm[field]), child, parentPathOrLinkpath);
    if (list.length) fm[field] = list; else delete fm[field];
  }));
}
/** Drop or bulk move: items [{child, from}], to (null — root), move (true) or add a parent, anchor before/after a sibling. */
export async function dropCards(items, toParent, move, anchor) {
  const field = PARENTS_FIELD;
  const seen = new Set();
  const ok = [];
  for (const it of items) {
    if (!vault.notes.has(it.child) || seen.has(it.child)) continue;
    seen.add(it.child);
    if (toParent && (toParent === it.child || graph.isDescendant(it.child, toParent))) {
      notice(t("cannotNest", { child: baseName(it.child), parent: baseName(toParent) }));
      continue;
    }
    ok.push(it);
  }
  if (!ok.length) return;
  let order = null;
  if (anchor) {
    const siblings = graph.sortedChildren(toParent, manualCmp);
    order = reorderBlock(siblings, ok.map((x) => x.child), anchor.path, anchor.pos);
  }
  let moved = 0, added = 0, removed = 0;
  await txn(null, async () => {
    for (const { child, from } of ok) {
      const parentsNow = graph.parentsOf(child);
      const sameParent = toParent === from;
      const removeFrom = !sameParent && from && (move || toParent === null) ? from : null;
      const addTo = toParent && !parentsNow.includes(toParent) ? toParent : null;
      if (!removeFrom && !addTo && !(order && !toParent)) continue;
      await updateFM(child, (fm) => {
        let list = toStringList(fm[field]);
        if (removeFrom) list = withoutParent(list, child, removeFrom);
        if (addTo) list.push(`[[${linkText(addTo)}]]`);
        if (list.length) fm[field] = list; else delete fm[field];
        if (order && !toParent) fm.order = order.indexOf(child) + 1;
      });
      if (addTo && removeFrom) moved++; else if (addTo) added++; else if (removeFrom) removed++;
    }
    if (order && toParent) await updateFM(toParent, (fm) => { fm.child_order = order.map((p) => `[[${linkText(p)}]]`); });
    if (order && !toParent) {
      const mine = new Set(ok.map((x) => x.child));
      for (let i = 0; i < order.length; i++) {
        if (mine.has(order[i])) continue;
        if (vault.notes.get(order[i])?.fm?.order === i + 1) continue;
        await updateFM(order[i], (fm) => { fm.order = i + 1; });
      }
    }
    const one = ok.length === 1 ? baseName(ok[0].child) : null;
    const toName = toParent ? baseName(toParent) : "";
    const lines = [];
    if (moved) lines.push(one ? t("movedOne", { card: one, to: toName }) : t("movedMany", { n: moved, to: toName }));
    if (added) lines.push(one ? t("addedOne", { card: one, to: toName }) : t("addedMany", { n: added, to: toName }));
    if (removed && !toParent) lines.push(one ? t("removedOne", { card: one, from: ok[0].from ? baseName(ok[0].from) : "" }) : t("removedMany", { n: removed }));
    if (!lines.length && order) lines.push(t("orderChanged"));
    return lines.join("\n");
  });
  if (order && board.sort !== "manual") { board.sort = "manual"; persistBoard(); renderBoard(); notice(t("switchedManual")); }
}
export async function setIconFor(paths, iconName) {
  await txn(t("iconChanged"), async () => { for (const p of paths) await updateFM(p, (fm) => { if (iconName) fm.icon = iconName; else delete fm.icon; }); });
}
export async function setChildTemplate(parent, tplPath) {
  await txn(tplPath ? t("templateSet", { name: baseName(tplPath) }) : t("templateRemoved"), () => updateFM(parent, (fm) => {
    if (tplPath) fm.child_template = `[[${linkText(tplPath)}]]`; else delete fm.child_template;
  }));
}
export async function deleteCards(paths) {
  paths = paths.filter((p) => vault.notes.has(p));
  if (!paths.length) return;
  if (paths.length > 1) {
    const ok = await confirmModal(t("confirmDeleteTitle"), t("confirmDeleteMany", { n: paths.length }), t("menuDelete"));
    if (!ok) return;
  }
  await txn(null, async () => {
    for (const p of paths) {
      const n = vault.notes.get(p);
      if (!n) continue;
      if (vault.fs.kind === "disk") {
        let tp = ".trash/" + p.split("/").pop(), i = 1;
        while (await vault.fs.exists(tp)) tp = `.trash/${baseName(p)} ${i++}.md`;
        await vault.fs.write(tp, n.raw);
      }
      await removeNote(p);
      board.selection.delete(p);
      if (editor.path === p) closeEditor(true);
    }
    return paths.length === 1 ? t("deletedUndo", { name: baseName(paths[0]) }) : t("deletedMany", { n: paths.length });
  });
}
/** Rename a card and update links to it everywhere. */
export async function renameCard(path, newTitle) {
  const clean = sanitizeTitle(newTitle);
  if (!clean || clean === baseName(path)) return path;
  const newPath = (dirName(path) ? dirName(path) + "/" : "") + clean + ".md";
  if ([...vault.allPaths].some((p) => p.toLowerCase() === newPath.toLowerCase() && p !== path)) { notice(t("renameExists", { name: clean })); return path; }
  if (editor.path === path && editor.dirty) await saveEditor();
  const n = vault.notes.get(path);
  const oldName = baseName(path);
  const referrers = [];
  for (const other of vault.notes.values()) {
    if (other.path === path) continue;
    if (other.raw.includes(oldName)) referrers.push(other.path);
  }
  await vault.fs.write(newPath, n.raw);
  await vault.fs.remove(path);
  vault.notes.delete(path); vault.allPaths.delete(path);
  vault.notes.set(newPath, parseNote(newPath, n.raw, Date.now())); vault.allPaths.add(newPath);
  vault.sizes.delete(path); vault.sizes.set(newPath, n.raw.length);
  syncHook("rename", newPath, path);
  // Links that resolved to the old path: resolve against the old name index, then rewrite
  const oldIndex = new Map(vault.byName);
  indexNames();
  const newText = linkText(newPath);
  for (const rp of referrers) {
    const r = vault.notes.get(rp);
    const raw = r.raw.replace(/(!?\[\[)([^\]|#]+)([^\]]*\]\])/g, (m, a, lp, rest) => {
      const k = baseName(lp.trim().toLowerCase() + ".md").toLowerCase();
      const cands = oldIndex.get(k) || [];
      const pointed = lp.includes("/") ? (lp.trim().toLowerCase() + ".md") === path.toLowerCase() : cands.includes(path) && (cands.length === 1 || resolveLinkWith(cands, rp) === path);
      return pointed ? a + newText + rest : m;
    });
    if (raw !== r.raw) await writeRaw(rp, raw);
  }
  // Pins, views, board, history
  S.pinned = S.pinned.map((p) => (p === path ? newPath : p));
  S.savedViews = S.savedViews.map((v) => (v.target === path ? { ...v, target: newPath } : v));
  if (board.target === path) board.target = newPath;
  board.history = board.history.map((p) => (p === path ? newPath : p));
  if (board.selection.delete(path)) board.selection.add(newPath);
  tree.expanded = new Set([...tree.expanded].map((k) => k.split("\u0000").map((p) => (p === path ? newPath : p)).join("\u0000")));
  if (editor.path === path) editor.path = newPath;
  await saveSettings();
  persistBoard();
  refresh();
  notice(t("renamed", { name: clean }));
  return newPath;
}
function resolveLinkWith(cands, source) {
  const same = cands.find((p) => dirName(p) === dirName(source));
  return same || [...cands].sort((a, b) => a.length - b.length)[0];
}
export async function togglePin(path) {
  S.pinned = S.pinned.includes(path) ? S.pinned.filter((p) => p !== path) : [...S.pinned, path];
  await saveSettings();
  renderTree();
}
export async function saveCurrentView() {
  const name = await promptModal(t("viewName"), board.target ? baseName(board.target) : t("allCards"));
  if (!name) return;
  S.savedViews = [...S.savedViews, {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, target: board.target,
    sort: board.sort, filter: structuredClone(board.filter),
  }];
  await saveSettings();
  renderTree();
  notice(t("viewSaved", { name }));
}
export function applyView(v) {
  board.history.push(board.target);
  Object.assign(board, { target: v.target && graph.has(v.target) ? v.target : null, sort: v.sort ?? board.sort });
  board.filter = { query: v.filter?.query || "", tags: v.filter?.tags || [] };
  board.searchOpen = !!(board.filter.query || board.filter.tags.length);
  board.selection.clear(); board.rendered = 60;
  persistBoard();
  renderBoard(); renderTree();
}

/* Prompts for actions */
function cardItems(exclude = new Set()) {
  return [...graph.nodes].filter((p) => !exclude.has(p)).sort((a, b) => baseName(a).localeCompare(baseName(b), undefined, { numeric: true })).map((p) => ({
    value: p, title: baseName(p), icon: cardIcon(p) || "file-text", note: dirName(p),
  }));
}
export async function promptAddParent(paths) {
  const ex = new Set(paths);
  const pick = await suggestModal({ placeholder: t("pickParent"), items: cardItems(ex), allowCreate: true });
  if (!pick) return;
  let parent = pick.value;
  if (pick.create) parent = await createCard(pick.create, null);
  if (paths.length === 1) return addParent(paths[0], parent);
  await dropCards(paths.map((c) => ({ child: c, from: null })), parent, false, null);
}
export async function promptMove(items) {
  const ex = new Set(items.map((i) => i.child));
  const pick = await suggestModal({ placeholder: t("pickMoveTarget"), items: [{ value: null, title: t("rootTarget"), icon: "home" }, ...cardItems(ex)] });
  if (!pick) return;
  await dropCards(items, pick.value, true, null);
}
export async function promptRemoveParent(path) {
  const ps = graph.parentsOf(path).filter((p) => graph.has(p));
  const un = graph.unresolvedParentsOf(path);
  const all = [...ps.map((p) => ({ value: p, title: baseName(p), icon: cardIcon(p) || "layers" })), ...un.map((u) => ({ value: u, title: u, icon: "alert-triangle", note: t("parentMissing") }))];
  if (!all.length) return;
  if (all.length === 1) return removeParent(path, all[0].value);
  const pick = await suggestModal({ placeholder: t("pickRemoveParent"), items: all });
  if (pick) await removeParent(path, pick.value);
}
export async function promptIcon(paths) {
  const cur = paths.length === 1 ? cardIcon(paths[0]) : null;
  const pick = await iconModal(cur);
  if (pick === undefined) return;
  await setIconFor(paths, pick);
}
export async function promptTemplate(parent) {
  const pool = [...vault.notes.keys()].filter((p) => p !== parent);
  const pick = await suggestModal({ placeholder: t("pickTemplate"), items: pool.map((p) => ({ value: p, title: baseName(p), icon: "layout-template", note: dirName(p) })) });
  if (pick) await setChildTemplate(parent, pick.value);
}
export async function quickOpen() {
  const pick = await suggestModal({ placeholder: t("pickCard"), items: cardItems(), allowCreate: true, hint: true });
  if (!pick) return;
  if (pick.create) { await createCard(pick.create, board.target, "", undefined, { open: true }); return; }
  setTarget(pick.value);
}


/* ---------- tags */
/** The tags a note's frontmatter lists (tags: or tag:), without the #. */
export function fmTagList(fm) {
  const v = fm?.tags ?? fm?.tag;
  const raw = Array.isArray(v) ? v.flat() : typeof v === "string" ? v.split(/[,\s]+/) : [];
  return raw.map((x) => String(x).trim().replace(/^#+/, "")).filter(Boolean);
}
/** A typed tag as it goes into the frontmatter: no #, spaces become dashes, only tag characters. */
export function cleanTag(s) { return String(s).trim().replace(/^#+/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_/-]/gu, ""); }
/** Every tag in the vault with the number of notes that have it, most used first. */
export function vaultTags() {
  const counts = new Map();
  for (const n of vault.notes.values()) for (const tg of n.tags) {
    const name = tg.replace(/^#/, ""), k = name.toLowerCase();
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { name, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
export async function addTags(paths, tags) {
  tags = tags.map(cleanTag).filter(Boolean);
  if (!tags.length) return;
  await txn(null, async () => {
    for (const p of paths) await updateFM(p, (fm) => {
      const cur = fmTagList(fm);
      const have = new Set(cur.map((x) => x.toLowerCase()));
      const add = tags.filter((x) => !have.has(x.toLowerCase()));
      if (!add.length) return;
      delete fm.tag;
      fm.tags = [...cur, ...add];
    });
  });
}
export async function removeTag(path, tag) {
  await txn(null, () => updateFM(path, (fm) => {
    const l = fmTagList(fm).filter((x) => x.toLowerCase() !== tag.toLowerCase());
    delete fm.tag;
    if (l.length) fm.tags = l; else delete fm.tags;
  }));
}
/** The notes a tag command acts on: the open note while typing in it, else the selection, the focused card, the open note, the board's card. */
export function tagTargets(focusEl = document.activeElement) {
  if (editor.path && focusEl?.closest?.(".sn-editor")) return [editor.path];
  const sel = [...board.selection].filter((p) => vault.notes.has(p));
  if (sel.length) return sel;
  const card = focusEl?.closest?.(".sn-card")?.dataset.path;
  if (card && vault.notes.has(card)) return [card];
  return [editor.path, board.target].filter((p) => p && vault.notes.has(p)).slice(0, 1);
}
/** Pick a tag (an existing one or a new one) and add it to the notes. */
export async function promptAddTag(paths) {
  paths = paths.filter((p) => vault.notes.has(p));
  if (!paths.length) return;
  const hasAll = (k) => paths.every((p) => vault.notes.get(p).tags.some((x) => x.replace(/^#/, "").toLowerCase() === k));
  const items = vaultTags().filter((x) => !hasAll(x.name.toLowerCase())).map((x) => ({ value: x.name, title: "#" + x.name, note: String(x.n), icon: "hash" }));
  const pick = await suggestModal({ placeholder: t("pickTag"), items, allowCreate: true });
  if (!pick) return;
  const tag = cleanTag(pick.create ?? pick.value);
  if (!tag) return;
  await addTags(paths, [tag]);
  notice(t("tagAdded", { tag: "#" + tag, n: paths.length }));
}
