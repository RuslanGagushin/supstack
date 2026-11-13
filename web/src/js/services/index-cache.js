/* =========================================================
   The index cache: what reading a vault learnt about each note (its text, frontmatter, tags and links), kept on this
   device in IndexedDB, so reopening the vault reads and parses only the notes that changed since (spec PERF-5).
   Never in the vault itself. A note's entry counts only while the file's modification time and size are the ones
   it was read with; anything odd in the cache (another version, a damaged entry, no IndexedDB at all) makes it
   read the files as before (PERF-6).
   ========================================================= */

/** Bump when parseNote keeps something new or different: every vault's cache is then dropped once. */
export const CACHE_VERSION = 1;
const DB = "supstack-index";
const SEP = "\u0000";

/** In memory while a vault is open: path → { mtime, size } of what the cache holds for it. */
const stored = new Map();
let vaultKey = null;
let dbPromise = null;
let flushTimer = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("notes"); r.result.createObjectStore("meta"); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("index cache blocked"));
    }).catch((e) => { console.warn("no index cache", e); dbPromise = null; return null; });
  }
  return dbPromise;
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const txDone = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
const range = (key) => IDBKeyRange.bound(key + SEP, key + SEP + "￿");

/** Which vault the cache is for: a vault on disk only (a demo or a copy has nothing to come back to). */
export function cacheKeyOf(fs) {
  if (!fs || fs.kind !== "disk" || typeof indexedDB === "undefined") return null;
  return (fs.native ? "native:" + fs.root : "folder:" + fs.name);
}

/** A cached entry is used only when it has every part parseNote would make, with the right types. */
function valid(e) {
  return !!e && typeof e.path === "string" && typeof e.raw === "string" && Number.isFinite(e.mtime) && Number.isFinite(e.size) &&
    e.fm !== null && typeof e.fm === "object" && !Array.isArray(e.fm) && (e.fmError === null || typeof e.fmError === "string") &&
    Array.isArray(e.tags) && e.tags.every((x) => typeof x === "string") && Array.isArray(e.links) && e.links.every((x) => typeof x === "string");
}

/** The cache of the vault in `fs` as path → entry; empty when there is none or it can't be used. */
export async function loadIndexCache(fs) {
  clearTimeout(flushTimer); flushTimer = null;
  stored.clear();
  vaultKey = cacheKeyOf(fs);
  const out = new Map();
  if (!vaultKey) return out;
  try {
    const db = await openDb();
    if (!db) return out;
    const tx = db.transaction(["notes", "meta"], "readonly");
    const [meta, entries] = await Promise.all([done(tx.objectStore("meta").get(vaultKey)), done(tx.objectStore("notes").getAll(range(vaultKey)))]);
    if (meta?.version !== CACHE_VERSION) { await dropVault(db, vaultKey); return out; }
    for (const e of entries) if (valid(e)) { out.set(e.path, e); stored.set(e.path, { mtime: e.mtime, size: e.size }); }
  } catch (e) { console.warn("index cache not read", e); out.clear(); stored.clear(); }
  return out;
}
async function dropVault(db, key) {
  const tx = db.transaction(["notes", "meta"], "readwrite");
  tx.objectStore("notes").delete(range(key));
  tx.objectStore("meta").put({ version: CACHE_VERSION }, key);
  await txDone(tx);
}

/**
 * Bring the cache in line with the notes in memory: write the ones that are new or changed, drop the ones that are gone.
 * `notes` is vault.notes, `sizes` vault.sizes.
 */
export async function flushIndexCache(notes, sizes) {
  clearTimeout(flushTimer); flushTimer = null;
  const key = vaultKey;
  if (!key) return 0;
  const put = [], gone = [];
  for (const n of notes.values()) {
    const size = sizes.get(n.path);
    if (!Number.isFinite(n.mtime) || !Number.isFinite(size)) continue;
    const s = stored.get(n.path);
    if (!s || s.mtime !== n.mtime || s.size !== size) put.push({ path: n.path, raw: n.raw, mtime: n.mtime, size, fm: n.fm, fmError: n.fmError, tags: n.tags, links: n.links });
  }
  for (const p of stored.keys()) if (!notes.has(p)) gone.push(p);
  if (!put.length && !gone.length) return 0;
  try {
    const db = await openDb();
    if (!db || key !== vaultKey) return 0;
    const tx = db.transaction(["notes", "meta"], "readwrite");
    const st = tx.objectStore("notes");
    const written = put.filter((e) => { try { st.put(e, key + SEP + e.path); return true; } catch (err) { console.warn("not cached", e.path, err); return false; } }); // a value IndexedDB can't store
    for (const p of gone) st.delete(key + SEP + p);
    tx.objectStore("meta").put({ version: CACHE_VERSION }, key);
    await txDone(tx);
    if (key !== vaultKey) return 0;
    for (const e of written) stored.set(e.path, { mtime: e.mtime, size: e.size });
    for (const p of gone) stored.delete(p);
    return written.length + gone.length;
  } catch (e) { console.warn("index cache not written", e); return 0; }
}
/** Write the cache a little after the last change, so a burst of edits is one write. */
export function scheduleIndexFlush(notes, sizes, ms = 3000) {
  if (!vaultKey) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushIndexCache(notes, sizes), ms);
}
/** Forget everything cached for the vault in `fs`: its next opening reads every note. */
export async function dropIndexCache(fs) {
  const key = cacheKeyOf(fs);
  if (!key) return;
  const db = await openDb();
  if (db) await dropVault(db, key);
  if (key === vaultKey) stored.clear();
}
/** The vault closed (or another one opens): stop writing for it. */
export function closeIndexCache() {
  clearTimeout(flushTimer); flushTimer = null;
  vaultKey = null;
  stored.clear();
}
