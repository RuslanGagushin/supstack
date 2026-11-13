/* =========================================================
   Writing notes + undo.
   Every change to a note goes through writeRaw (or removeNote); txn() groups the changes of one
   action so undo() can put them all back. The page hears about them through services/events.js.
   ========================================================= */
import { t } from "../core/i18n.js";
import { baseName } from "../core/util.js";
import { formatMoment } from "../core/dates.js";
import { dumpYaml, splitNote } from "../core/frontmatter.js";
import { emit } from "./events.js";
import { undoStack, vault } from "./state.js";
import { indexNames, parseNote } from "./vault.js";
import { syncHook } from "./sync.js";
import { scheduleIndexFlush } from "./index-cache.js";

const utf8 = new TextEncoder();
let currentTxn = null; // the open txn(): notes it changes keep their text from before, for undo
export async function writeRaw(path, raw, { silentEditor = false, fromSync = false } = {}) {
  if (!fromSync && currentTxn && !currentTxn.before.has(path)) currentTxn.before.set(path, vault.notes.get(path)?.raw ?? null);
  let mtime;
  try { mtime = await vault.fs.write(path, raw); }
  catch (e) { emit("notice", t("writeFailed", { name: baseName(path), msg: e.message || e })); throw e; }
  const isNew = !vault.notes.has(path);
  vault.notes.set(path, parseNote(path, raw, mtime || Date.now()));
  vault.allPaths.add(path);
  vault.sizes.set(path, utf8.encode(raw).length); // bytes, as the disk counts them
  if (isNew) indexNames();
  scheduleIndexFlush(vault.notes, vault.sizes);
  if (!fromSync) syncHook(isNew ? "create" : "modify", path);
  emit("written", path, { silentEditor });
}
/** "cards/Note.md" → "cards/Note (conflict 2026-11-10 10.00.00).md", as git sync names the other side of a conflict. */
export function conflictPath(path, date = new Date()) {
  const name = path.slice(path.lastIndexOf("/") + 1), dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let p = path.slice(0, path.length - name.length) + `${stem} (conflict ${formatMoment(date, "YYYY-MM-DD HH.mm.ss")})${ext}`;
  for (let i = 2; vault.allPaths.has(p); i++) p = p.replace(/(\)| \d+\))(\.[^./]*)?$/, (m, close, e = "") => ` ${i})${e}`);
  return p;
}
export async function updateFM(path, fn) {
  await emit("flush", path);
  const n = vault.notes.get(path);
  if (!n) return;
  if (n.fmError) { emit("notice", t("fmError", { msg: n.fmError })); return; }
  const fm = structuredClone(n.fm);
  fn(fm);
  const { body } = splitNote(n.raw);
  const keys = Object.keys(fm);
  const raw = (keys.length ? "---\n" + dumpYaml(fm) + "---\n" : "") + body;
  if (raw !== n.raw) await writeRaw(path, raw);
}
export async function removeNote(path, { fromSync = false } = {}) {
  if (!fromSync && currentTxn && !currentTxn.before.has(path)) currentTxn.before.set(path, vault.notes.get(path)?.raw ?? null);
  await vault.fs.remove(path);
  vault.notes.delete(path);
  vault.allPaths.delete(path);
  vault.sizes.delete(path);
  indexNames();
  scheduleIndexFlush(vault.notes, vault.sizes);
  if (!fromSync) syncHook("delete", path);
}
export async function txn(label, fn) {
  const tx = { label: "", before: new Map() };
  currentTxn = tx;
  try { const l = await fn(tx); tx.label = l ?? label; }
  finally { currentTxn = null; }
  emit("changed");
  if (tx.before.size) {
    undoStack.push(tx);
    if (undoStack.length > 20) undoStack.shift();
    if (tx.label) emit("notice", tx.label, { undo: true });
  } else if (tx.label) emit("notice", tx.label);
}
export async function undo() {
  const tx = undoStack.pop();
  if (!tx) { emit("notice", t("nothingToUndo")); return; }
  for (const [path, raw] of tx.before) {
    if (raw === null) { if (vault.notes.has(path)) await removeNote(path); }
    else await writeRaw(path, raw);
  }
  indexNames();
  emit("changed");
  emit("notice", t("undone", { label: tx.label.split("\n")[0] }));
}

