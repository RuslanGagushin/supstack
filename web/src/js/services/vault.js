/* =========================================================
   The vault: notes and their index, link resolution, the hierarchy graph, card sorting, the settings,
   reading a vault and picking up changes made outside the page.
   ========================================================= */
import { t } from "../core/i18n.js";
import { baseName, dirName } from "../core/util.js";
import { fmInner, noteLinks, noteTags, parentLinkpaths, parseYaml, splitNote } from "../core/frontmatter.js";
import { HierarchyGraph } from "../core/graph.js";
import { computeModel } from "../core/board-model.js";
import { headingsText, WordIndex } from "../core/search.js";
import { lsGet, lsSet } from "./storage.js";
import { emit } from "./events.js";
import { board, DEFAULTS, graph, PARENTS_FIELD, resetSettings, S, setGraph, tree, undoStack, vault } from "./state.js";
import { ATTACHMENTS, CARDS, DAILY, inFolder, vaultFolder } from "./folders.js";
import { dropAttachment } from "./attachments.js";
import { stopSync, syncHook } from "./sync.js";
import { flushIndexCache, loadIndexCache, scheduleIndexFlush } from "./index-cache.js";

export function isMd(p) { return /\.md$/i.test(p); }
export function isCard(path) {
  if (!isMd(path)) return false;
  if (!inFolder(path, CARDS) && !inFolder(path, DAILY)) return false;
  return true;
}
/** A note from its text. `cached` (from services/index-cache.js, for this same text) skips parsing the frontmatter, tags and links. */
export function parseNote(path, raw, mtime, cached = null) {
  const { fm: fmRaw, body } = splitNote(raw);
  let fm = {}, fmError = null;
  if (cached) ({ fm, fmError } = cached);
  else if (fmRaw) { try { fm = parseYaml(fmInner(fmRaw)); } catch (e) { fmError = String(e.message || e).split("\n")[0]; } }
  const created = Date.parse(fm.created ?? fm.date ?? "") || null;
  return { path, name: baseName(path), raw, fmRaw, body, fm, fmError, mtime, ctime: created || mtime,
    tags: cached ? cached.tags : noteTags(fm, body), links: cached ? cached.links : noteLinks(body) };
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
/** Names compare as localeCompare(…, { numeric: true, sensitivity: "base" }) does, with one collator made once. */
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** A comparator for one sort: make a new one for each, as it remembers each note's sort keys while it sorts. */
export function makeComparator(mode) {
  const byName = (a, b) => nameCollator.compare(a.name, b.name);
  const infos = new Map();
  const infoOf = (p) => { let i = infos.get(p); if (!i) infos.set(p, (i = sortInfo(p))); return i; };
  return (pa, pb, parent) => {
    if (mode === "manual" && parent) {
      const ia = graph.positionIn(parent, pa), ib = graph.positionIn(parent, pb);
      if (ia >= 0 || ib >= 0) {
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        if (ia !== ib) return ia - ib;
      }
    }
    const a = infoOf(pa), b = infoOf(pb);
    switch (mode) {
      case "name": return byName(a, b);
      case "modified": return b.mtime - a.mtime || byName(a, b);
      case "created": return b.ctime - a.ctime || byName(a, b);
      default: return a.order - b.order || byName(a, b);
    }
  };
}
export const manualCmp = (a, b, p) => makeComparator("manual")(a, b, p);

/** A note's text. A file that is not UTF-8 is refused (the native side refuses it too): decoded with replacement
 *  characters, it would be damaged by its next save. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
async function noteText(file) {
  return file instanceof Blob ? strictUtf8.decode(await file.arrayBuffer()) : file.text();
}
/** Notes that could not be read, with the mtime they had: not tried again until they change. */
const unreadable = new Map();
function cannotRead(path, mtime, e) {
  const fresh = !unreadable.has(path);
  unreadable.set(path, mtime);
  console.warn("read failed", path, e);
  return fresh;
}
function reportUnreadable(paths) {
  if (paths.length) emit("notice", t("notReadable", { names: paths.map(baseName).join(", ") }));
}

/** Read a vault: every note, the attachments' sizes and dates, the settings, and the board and tree as they were left.
 *  ui/shell.js loadVault shows it. */
export async function readVault(fs) {
  await stopSync();
  vault.fs?.unwatch?.();
  vault.watching = false;
  vault.fs = fs;
  vault.notes.clear(); vault.files.clear(); vault.allPaths.clear(); vault.sizes.clear(); vault.mtimes.clear();
  const cache = await loadIndexCache(fs);
  const stats = vault.stats = { parsed: 0, cached: 0 };
  const list = await fs.list();
  const md = [], others = [];
  for (const f of list) {
    vault.allPaths.add(f.path);
    if (isMd(f.path)) md.push(f);
    else { addAttachment(f.path); if (f.mtime) vault.mtimes.set(f.path, f.mtime); if (f.handle) others.push(f); }
  }
  let i = 0;
  const failed = [];
  unreadable.clear();
  const worker = async () => {
    while (i < md.length) {
      const f = md[i++];
      let file = null;
      try {
        file = f.handle ? await f.handle.getFile() : await fs.readFile(f.path);
        // the cache's entry, while the file is as it was read then: no reading, no parsing
        const c = cache.get(f.path);
        if (c && file.lastModified && c.mtime === file.lastModified && c.size === file.size) {
          vault.notes.set(f.path, parseNote(f.path, c.raw, c.mtime, c));
          vault.sizes.set(f.path, file.size);
          stats.cached++;
          continue;
        }
        const raw = await noteText(file);
        vault.notes.set(f.path, parseNote(f.path, raw, file.lastModified || Date.now()));
        vault.sizes.set(f.path, file.size);
        stats.parsed++;
      } catch (e) { if (cannotRead(f.path, file?.lastModified ?? f.mtime ?? 0, e)) failed.push(f.path); }
    }
    while (others.length) {
      const f = others.pop();
      try { const file = await f.handle.getFile(); vault.sizes.set(f.path, file.size); if (file.lastModified) vault.mtimes.set(f.path, file.lastModified); } catch { /* gone */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  reportUnreadable(failed.sort());
  indexNames();
  await loadSettings();
  const moved = await gatherNotes();
  const saved = lsGet(boardKey(), null);
  Object.assign(board, {
    target: null, sort: S.defaultSort,
    filter: { query: "", tags: [] }, searchOpen: false, history: [], selection: new Set(), selectMode: false, rendered: 60,
  });
  if (saved) {
    for (const k of ["target", "sort", "tagView", "view"]) if (saved[k] !== undefined) board[k] = saved[k];
    if (saved.filter) board.filter = { query: saved.filter.query || "", tags: saved.filter.tags || [], scope: saved.filter.scope === "all" ? "all" : "here" };
    board.searchOpen = !!(board.filter.query || board.filter.tags.length);
    tree.expanded = new Set(saved.treeExpanded || []);
  } else tree.expanded = new Set();
  if (moved.size) followMoves(moved);
  undoStack.length = 0;
  setGraph(buildGraph());
  flushIndexCache(vault.notes, vault.sizes);
  lastFullPoll = Date.now(); // reading it was a full look
  watchVault(fs);
  warmSearchIndex(fs);
}
/** On desktop the app tells the page which files changed (PERF-3); the full look in pollChanges is then only a fallback. */
async function watchVault(fs) {
  if (!fs.watch) return;
  const ok = await fs.watch((present, gone) => { if (vault.fs === fs) pickUp(present, gone); });
  if (vault.fs === fs) vault.watching = ok;
  else if (ok) fs.unwatch();
}
const boardKey = () => "sn-board:" + (vault.fs?.kind || "") + ":" + (vault.fs?.name || "");
export function persistBoard() {
  lsSet(boardKey(), {
    target: board.target, sort: board.sort,
    filter: board.filter, tagView: board.tagView || null, view: board.view || null, treeExpanded: [...tree.expanded],
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
let lastFullPoll = 0;
/** How often the whole vault is listed while the app watches the folder. */
export const WATCHED_POLL_MS = 60000;
/**
 * Pick up what changed on disk since the last look: ui/boot.js calls it every few seconds while the page is visible.
 * While the app watches the folder (vault.watching), the changes arrive on their own and this lists the vault at most
 * once a minute, in case the system missed something; `force` lists it anyway (after a sync).
 */
export async function pollChanges({ force = false } = {}) {
  if (polling || !vault.fs || vault.fs.kind !== "disk") return;
  if (vault.watching && !force && Date.now() - lastFullPoll < WATCHED_POLL_MS) return;
  polling = true;
  try {
    const list = await vault.fs.list();
    lastFullPoll = Date.now();
    const seen = new Set(list.map((f) => f.path));
    await pickUp(list, [...vault.allPaths].filter((p) => !seen.has(p)));
  } catch (e) { console.warn("poll failed", e); } finally { polling = false; }
}
/** Take in files that are new or changed (listing entries with a handle) and the paths that are gone. */
let picking = Promise.resolve();
function pickUp(present, gone) {
  picking = picking.then(() => pickUpNow(present, gone)).catch((e) => console.warn("pick up failed", e));
  return picking;
}
async function pickUpNow(list, gone) {
  let changed = false;
  const failed = [];
  for (const f of list) {
    if (!vault.allPaths.has(f.path)) {
      vault.allPaths.add(f.path);
      if (!isMd(f.path)) { addAttachment(f.path); try { const file = await f.handle.getFile(); vault.sizes.set(f.path, file.size); vault.mtimes.set(f.path, file.lastModified || Date.now()); } catch { /* gone */ } syncHook("create", f.path); changed = true; }
    }
    if (!isMd(f.path)) continue;
    const file = await f.handle.getFile();
    const n = vault.notes.get(f.path);
    if (n && n.mtime >= file.lastModified) continue;
    if (unreadable.get(f.path) === file.lastModified) continue;
    let raw;
    // one file that cannot be read does not stop the others from being picked up
    try { raw = await noteText(file); } catch (e) {
      if (cannotRead(f.path, file.lastModified, e)) failed.push(f.path);
      if (n) { vault.notes.delete(f.path); changed = true; } // its old text must not be saved over the file
      continue;
    }
    unreadable.delete(f.path);
    if (n && n.raw === raw) { n.mtime = file.lastModified; continue; }
    vault.notes.set(f.path, parseNote(f.path, raw, file.lastModified));
    vault.sizes.set(f.path, file.size);
    syncHook(n ? "modify" : "create", f.path);
    changed = true;
  }
  // a folder that is gone takes its files with it (the watcher names the folder)
  const goneFiles = new Set();
  for (const p of gone) {
    if (vault.allPaths.has(p)) goneFiles.add(p);
    else for (const q of vault.allPaths) if (q.startsWith(p + "/")) goneFiles.add(q);
  }
  for (const p of goneFiles) {
    vault.allPaths.delete(p);
    vault.sizes.delete(p);
    if (!isMd(p)) { vault.mtimes.delete(p); dropAttachment(p); changed = true; }
    if (vault.notes.delete(p)) changed = true;
    syncHook("delete", p);
  }
  reportUnreadable(failed);
  if (changed) {
    indexNames();
    emit("changed", { disk: true });
    scheduleIndexFlush(vault.notes, vault.sizes);
  }
}

/** The board's cards right now: core/board-model.js on this vault, the board's state and settings. */
/** The words of the vault's notes (core/search.js), brought up to date when a search needs it: a note whose object
 *  changed (every save, outside change and reread makes a new one) is indexed again. */
const searchIndex = new WordIndex();
const searchText = (n) => n.name + "\n" + n.raw;
export function syncSearchIndex() { return searchIndex.update(vault.notes, searchText); }
/** After a vault opens, index it a few hundred notes at a time, so the first search finds the work done
 *  and the page stays responsive meanwhile. A search before it is finished indexes the rest itself. */
function warmSearchIndex(fs) {
  const paths = [...vault.notes.keys()];
  let i = 0;
  const step = () => {
    if (vault.fs !== fs) return;
    const end = Math.min(paths.length, i + 400);
    for (; i < end; i++) { const n = vault.notes.get(paths[i]); if (n) searchIndex.set(n.path, n, searchText(n)); }
    if (i < paths.length) setTimeout(step, 0);
  };
  setTimeout(step, 500);
}
export function boardModel() {
  return computeModel(graph, board, {
    cmp: makeComparator(board.sort), tagsOf: cardTags, maxCards: S.maxCards,
    textOf: (p) => searchText(vault.notes.get(p)),
    candidatesOf: (words) => { syncSearchIndex(); return searchIndex.candidates(words); },
    rankOf: (p) => { const n = vault.notes.get(p); return { title: n.name, headings: headingsText(n.body) }; },
  });
}
