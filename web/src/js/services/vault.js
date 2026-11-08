/* =========================================================
   The vault: notes and their index, link resolution, the hierarchy graph, card sorting, the settings,
   reading a vault and picking up changes made outside the page.
   ========================================================= */
import { baseName, dirName } from "../core/util.js";
import { fmInner, noteLinks, noteTags, parentLinkpaths, parseYaml, splitNote } from "../core/frontmatter.js";
import { HierarchyGraph } from "../core/graph.js";
import { computeModel, normDepth } from "../core/board-model.js";
import { lsGet, lsSet } from "./storage.js";
import { emit } from "./events.js";
import { board, DEFAULTS, graph, PARENTS_FIELD, resetSettings, S, setGraph, tree, undoStack, vault } from "./state.js";
import { ATTACHMENTS, CARDS, DAILY, inFolder, vaultFolder } from "./folders.js";
import { dropAttachment } from "./attachments.js";
import { stopSync, syncHook } from "./sync.js";

export function isMd(p) { return /\.md$/i.test(p); }
export function isCard(path) {
  if (!isMd(path)) return false;
  if (!inFolder(path, CARDS) && !inFolder(path, DAILY)) return false;
  return true;
}
export function parseNote(path, raw, mtime) {
  const { fm: fmRaw, body } = splitNote(raw);
  let fm = {}, fmError = null;
  if (fmRaw) { try { fm = parseYaml(fmInner(fmRaw)); } catch (e) { fmError = String(e.message || e).split("\n")[0]; } }
  const created = Date.parse(fm.created ?? fm.date ?? "") || null;
  return { path, name: baseName(path), raw, fmRaw, body, fm, fmError, mtime, ctime: created || mtime, tags: noteTags(fm, body), links: noteLinks(body) };
}
export function indexNames() {
  vault.byName.clear();
  for (const p of vault.notes.keys()) {
    const k = baseName(p).toLowerCase();
    (vault.byName.get(k) || vault.byName.set(k, []).get(k)).push(p);
  }
}
export function addAttachment(path) {
  const k = (path.split("/").pop() || "").toLowerCase();
  const arr = vault.files.get(k) || vault.files.set(k, []).get(k);
  if (!arr.includes(path)) arr.push(path);
}
/** Link resolution: exact path, then by name (same folder first, then the shortest path). */
export function resolveLink(linkpath, source = "") {
  if (!linkpath) return null;
  let lp = linkpath.trim().replace(/\\/g, "/");
  if (!lp) return null;
  const lower = lp.toLowerCase();
  const withMd = /\.md$/i.test(lp) ? lower : lower + ".md";
  if (lp.includes("/")) {
    const rel = (dirName(source) ? dirName(source) + "/" : "") + withMd;
    for (const p of vault.notes.keys()) { const pl = p.toLowerCase(); if (pl === withMd || pl === rel) return p; }
  }
  const cands = vault.byName.get(baseName(withMd).toLowerCase());
  if (!cands?.length) return null;
  if (lp.includes("/")) { const hit = cands.find((p) => p.toLowerCase().endsWith("/" + withMd)); if (hit) return hit; }
  if (cands.length === 1) return cands[0];
  const sameDir = cands.find((p) => dirName(p) === dirName(source));
  return sameDir || [...cands].sort((a, b) => a.length - b.length)[0];
}
export function resolveAttachment(name, source) {
  let n = name.trim().replace(/\\/g, "/");
  try { n = decodeURIComponent(n); } catch { /* keep */ }
  const lower = n.toLowerCase();
  if (vault.allPaths.has(n)) return n;
  const rel = (dirName(source) ? dirName(source) + "/" : "") + n;
  if (vault.allPaths.has(rel)) return rel;
  const cands = vault.files.get(lower.split("/").pop()) || [];
  return cands.find((p) => p.toLowerCase().endsWith(lower)) || cands[0] || null;
}
/** A wikilink to a non-note file ([[doc.pdf]]): the vault file it points at, if any. */
export function resolveFileLink(lp, source) {
  if (!lp || !/\.[a-z0-9]{1,8}$/i.test(lp) || /\.md$/i.test(lp)) return null;
  return resolveAttachment(lp, source);
}
export function linkText(path) {
  const name = baseName(path);
  return (vault.byName.get(name.toLowerCase()) || []).length > 1 ? path.replace(/\.md$/i, "") : name;
}
export function buildGraph() {
  const g = new HierarchyGraph();
  const field = PARENTS_FIELD;
  for (const n of vault.notes.values()) {
    if (!isCard(n.path)) continue;
    const parents = [], unresolved = [];
    for (const lp of parentLinkpaths(n.fm[field])) {
      const r = resolveLink(lp, n.path);
      if (r) parents.push(r); else unresolved.push(lp);
    }
    const order = parentLinkpaths(n.fm.child_order).map((lp) => resolveLink(lp, n.path)).filter(Boolean);
    const links = n.links.map((lp) => resolveLink(lp, n.path)).filter(Boolean);
    g.setNode(n.path, parents, unresolved, links, order);
  }
  return g;
}
export function cardIcon(path) { const v = vault.notes.get(path)?.fm?.icon; return typeof v === "string" && v.trim() ? v.trim() : null; }
export function cardTags(path) { return (vault.notes.get(path)?.tags || []).map((x) => x.replace(/^#/, "").toLowerCase()); }
function sortInfo(path) {
  const n = vault.notes.get(path);
  const o = Number(n?.fm?.order);
  return { order: Number.isFinite(o) ? o : Number.MAX_SAFE_INTEGER, name: baseName(path), mtime: n?.mtime ?? 0, ctime: n?.ctime ?? 0 };
}
export function makeComparator(mode) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return (pa, pb, parent) => {
    if (mode === "manual" && parent) {
      const ia = graph.positionIn(parent, pa), ib = graph.positionIn(parent, pb);
      if (ia >= 0 || ib >= 0) {
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        if (ia !== ib) return ia - ib;
      }
    }
    const a = sortInfo(pa), b = sortInfo(pb);
    switch (mode) {
      case "name": return byName(a, b);
      case "modified": return b.mtime - a.mtime || byName(a, b);
      case "created": return b.ctime - a.ctime || byName(a, b);
      default: return a.order - b.order || byName(a, b);
    }
  };
}
export const manualCmp = (a, b, p) => makeComparator("manual")(a, b, p);

/** Read a vault: every note, the attachments' sizes and dates, the settings, and the board and tree as they were left.
 *  ui/shell.js loadVault shows it. */
export async function readVault(fs) {
  await stopSync();
  vault.fs = fs;
  vault.notes.clear(); vault.files.clear(); vault.allPaths.clear(); vault.sizes.clear(); vault.mtimes.clear();
  const list = await fs.list();
  const md = [], others = [];
  for (const f of list) {
    vault.allPaths.add(f.path);
    if (isMd(f.path)) md.push(f);
    else { addAttachment(f.path); if (f.mtime) vault.mtimes.set(f.path, f.mtime); if (f.handle) others.push(f); }
  }
  let i = 0;
  const worker = async () => {
    while (i < md.length) {
      const f = md[i++];
      try {
        const file = f.handle ? await f.handle.getFile() : await fs.readFile(f.path);
        const raw = await file.text();
        vault.notes.set(f.path, parseNote(f.path, raw, file.lastModified || Date.now()));
        vault.sizes.set(f.path, file.size);
      } catch (e) { console.warn("read failed", f.path, e); }
    }
    while (others.length) {
      const f = others.pop();
      try { const file = await f.handle.getFile(); vault.sizes.set(f.path, file.size); if (file.lastModified) vault.mtimes.set(f.path, file.lastModified); } catch { /* gone */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  indexNames();
  await loadSettings();
  const moved = await gatherNotes();
  const saved = lsGet(boardKey(), null);
  Object.assign(board, {
    fresh: !saved, // nothing remembered for this vault on this device yet (ui/shell.js picks a phone's first layout)
    target: null, depth: normDepth(S.defaultDepth), layout: S.defaultLayout, sort: S.defaultSort, grouped: S.defaultGrouped,
    filter: { query: "", tags: [] }, searchOpen: false, history: [], selection: new Set(), selectMode: false, expanded: new Set(), rendered: 60,
  });
  if (saved) {
    for (const k of ["target", "depth", "layout", "sort", "grouped", "heroCollapsed", "tagView", "view"]) if (saved[k] !== undefined) board[k] = saved[k];
    board.depth = normDepth(board.depth);
    if (saved.filter) board.filter = { query: saved.filter.query || "", tags: saved.filter.tags || [], scope: saved.filter.scope === "all" ? "all" : "here" };
    board.searchOpen = !!(board.filter.query || board.filter.tags.length);
    tree.expanded = new Set(saved.treeExpanded || []);
  } else tree.expanded = new Set();
  if (moved.size) followMoves(moved);
  undoStack.length = 0;
  setGraph(buildGraph());
}
const boardKey = () => "sn-board:" + (vault.fs?.kind || "") + ":" + (vault.fs?.name || "");
export function persistBoard() {
  lsSet(boardKey(), {
    target: board.target, depth: board.depth, layout: board.layout, sort: board.sort, grouped: board.grouped,
    heroCollapsed: board.heroCollapsed, filter: board.filter, tagView: board.tagView || null, view: board.view || null, treeExpanded: [...tree.expanded],
  });
}
/** Notes outside cards/ and daily notes/ (attachments/ aside) move into cards/, keeping their subfolders, so links
 *  by name or by path (cards/Folder/Note ends with Folder/Note) still resolve. Returns old path → new path. */
async function gatherNotes() {
  const moved = new Map();
  const cards = vaultFolder(CARDS);
  for (const [p, n] of [...vault.notes]) {
    if (inFolder(p, CARDS) || inFolder(p, DAILY) || inFolder(p, ATTACHMENTS)) continue;
    let to = cards + "/" + p, i = 1;
    while (vault.allPaths.has(to)) to = `${cards}/${p.replace(/\.md$/i, "")} ${i++}.md`;
    try {
      const mtime = await vault.fs.write(to, n.raw);
      await vault.fs.remove(p);
      vault.notes.delete(p); vault.allPaths.delete(p);
      vault.notes.set(to, parseNote(to, n.raw, mtime || n.mtime)); vault.allPaths.add(to);
      vault.sizes.set(to, vault.sizes.get(p) ?? n.raw.length); vault.sizes.delete(p);
      moved.set(p, to);
    } catch (e) { console.warn("could not move into " + cards, p, e); }
  }
  if (moved.size) indexNames();
  return moved;
}
/** Pins, saved views, the board and the tree follow notes that moved. */
function followMoves(moved) {
  const m = (p) => moved.get(p) ?? p;
  S.pinned = S.pinned.map(m);
  S.savedViews = S.savedViews.map((v) => (v.target ? { ...v, target: m(v.target) } : v));
  board.target = board.target && m(board.target);
  board.history = board.history.map((p) => p && m(p));
  tree.expanded = new Set([...tree.expanded].map((k) => k.split("\u0000").map(m).join("\u0000")));
  saveSettings();
  persistBoard();
}
/** The vault's settings travel with it (Git sync included): pins, saved views, card, board and note options. */
export const SETTINGS_PATH = ".supstack/settings.json";
export const OLD_SETTINGS_PATH = ".obsidian/plugins/supsidian/data.json"; // where versions up to 0.15 kept them; moved on first open
async function loadSettings() {
  resetSettings(lsGet("sn-settings:" + vault.fs.name, {}));
  if (vault.fs.kind === "demo") return;
  let saved = null, moved = false;
  try { saved = JSON.parse(await vault.fs.read(SETTINGS_PATH)); } catch {
    try { saved = JSON.parse(await vault.fs.read(OLD_SETTINGS_PATH)); moved = true; } catch { /* none yet */ }
  }
  if (saved) for (const k of Object.keys(DEFAULTS)) if (saved[k] !== undefined) S[k] = saved[k];
  if (!Array.isArray(S.pinned)) S.pinned = [];
  if (!Array.isArray(S.savedViews)) S.savedViews = [];
  if (moved) await saveSettings();
}
/** This device keeps a copy; a vault on disk also gets them in SETTINGS_PATH. */
export async function saveSettings() {
  lsSet("sn-settings:" + vault.fs.name, S);
  if (vault.fs.kind !== "disk") return;
  try {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = S[k];
    await vault.fs.write(SETTINGS_PATH, JSON.stringify(out, null, 2));
  } catch (e) { console.warn("settings not saved to the vault", e); }
}

/* Watch for changes made elsewhere (other apps, sync) */
let polling = false;
/** Pick up what changed on disk since the last look (main.js calls it every few seconds while the page is visible). */
export async function pollChanges() {
  if (polling || !vault.fs || vault.fs.kind !== "disk") return;
  polling = true;
  try {
    const list = await vault.fs.list();
    const seen = new Set();
    let changed = false;
    for (const f of list) {
      seen.add(f.path);
      if (!vault.allPaths.has(f.path)) {
        vault.allPaths.add(f.path);
        if (!isMd(f.path)) { addAttachment(f.path); try { const file = await f.handle.getFile(); vault.sizes.set(f.path, file.size); vault.mtimes.set(f.path, file.lastModified || Date.now()); } catch { /* gone */ } syncHook("create", f.path); changed = true; }
      }
      if (!isMd(f.path)) continue;
      const file = await f.handle.getFile();
      const n = vault.notes.get(f.path);
      if (n && n.mtime >= file.lastModified) continue;
      const raw = await file.text();
      if (n && n.raw === raw) { n.mtime = file.lastModified; continue; }
      vault.notes.set(f.path, parseNote(f.path, raw, file.lastModified));
      vault.sizes.set(f.path, file.size);
      syncHook(n ? "modify" : "create", f.path);
      changed = true;
    }
    for (const p of [...vault.allPaths]) {
      if (seen.has(p)) continue;
      vault.allPaths.delete(p);
      vault.sizes.delete(p);
      if (!isMd(p)) { vault.mtimes.delete(p); dropAttachment(p); changed = true; }
      if (vault.notes.delete(p)) changed = true;
      syncHook("delete", p);
    }
    if (changed) {
      indexNames();
      emit("changed", { disk: true });
    }
  } catch (e) { console.warn("poll failed", e); } finally { polling = false; }
}

/** The board's cards right now: core/board-model.js on this vault, the board's state and settings. */
export function boardModel() {
  return computeModel(graph, board, {
    cmp: makeComparator(board.sort), tagsOf: cardTags, maxCards: S.maxCards,
    textOf: (p) => { const n = vault.notes.get(p); return n.name + "\n" + n.raw; },
  });
}
