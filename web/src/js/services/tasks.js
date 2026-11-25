/* =========================================================
   The vault's tasks: .supstack/tasks.jsonl (core/tasks.js is the format) read when the vault opens, written on every
   change (each an undoable txn), and read again when it changed on disk (a sync, another program).
   A task links to a note by the note's frontmatter `id:`, which is given to the note the first time a task links to it.
   The boxes in the notes are checklists: they are counted for a note's progress and are not tasks of the agenda.
   ========================================================= */
import { t, tt } from "../core/i18n.js";
import { formatMoment } from "../core/dates.js";
import { onow, orgParse, orgTsParse, taskState } from "../core/org.js";
import { ARCHIVE_PATH, countMovable, extractTasks, fnv, newNoteId, newTaskId, parseTasks, serializeTasks, taskEntry, TASKS_PATH, tidyTask, withNoteId } from "../core/tasks.js";
import { emit, on } from "./events.js";
import { vault } from "./state.js";
import { txn, txnKeep, writeRaw } from "./save.js";
import { syncHook } from "./sync.js";

export { TASKS_PATH, ARCHIVE_PATH };
/** The tasks as read from the file: records by id, and the file's lines that are not tasks (kept as they are). */
export const taskStore = { records: new Map(), extra: [], text: "", exists: false };
let entries = null; // the tasks as agenda entries, made again after any change to the tasks or the notes
let ids = null; // note id → path
const invalidate = () => { entries = null; ids = null; };
on("opened", invalidate);
on("written", invalidate);
on("changed", invalidate);

/** The note a frontmatter id belongs to (the first, should two notes have the same one). */
export function notePathOf(id) {
  if (id == null || id === "") return null;
  if (!ids) {
    ids = new Map();
    for (const n of vault.notes.values()) { const v = n.fm?.id; if (v != null && v !== "" && !ids.has(String(v))) ids.set(String(v), n.path); }
  }
  return ids.get(String(id)) ?? null;
}
/** Every task as an agenda entry. */
export function orgAll() {
  if (!entries) entries = [...taskStore.records.values()].map((r) => { const p = notePathOf(r.note); return taskEntry(r, p, p ? vault.notes.get(p) : null); });
  return entries;
}
export const taskById = (id) => taskStore.records.get(id) || null;

/* ---------- the file */
function apply(text, exists) {
  const { records, extra } = parseTasks(text);
  Object.assign(taskStore, { records, extra, text, exists });
  invalidate();
}
async function readFile(fs, path) {
  try { return { text: await fs.read(path), exists: true }; } catch { return { text: "", exists: false }; }
}
/** Read the tasks of the vault in `fs` (services/vault.js readVault calls it before the vault opens). */
export async function loadTasks(fs = vault.fs) {
  const { text, exists } = await readFile(fs, TASKS_PATH);
  apply(text, exists);
}
let writing = Promise.resolve(), pending = 0;
async function writeText(path, text) {
  pending++;
  writing = writing.then(() => vault.fs.write(path, text)).then(() => syncHook("modify", path), (e) => { emit("notice", t("writeFailed", { name: path.split("/").pop(), msg: e.message || e })); });
  try { await writing; } finally { pending--; }
}
async function writeTasks() {
  const text = serializeTasks(taskStore.records, taskStore.extra);
  taskStore.text = text; taskStore.exists = true;
  invalidate();
  await writeText(TASKS_PATH, text);
}
/** The file changed on disk (a sync brought other devices' tasks): read it again. services/vault.js pollChanges calls it. */
export async function reloadTasks() {
  if (!vault.fs || pending) return false;
  const { text, exists } = await readFile(vault.fs, TASKS_PATH);
  if (pending || text === taskStore.text) return false;
  apply(text, exists || taskStore.exists);
  emit("changed", { disk: true });
  return true;
}
const restoreTasks = async (text) => { apply(text, true); await writeText(TASKS_PATH, text); };
const keepTasks = () => txnKeep(TASKS_PATH, taskStore.text, restoreTasks);

/* ---------- changes */
/** Change task `id` with `fn(record)`, which returns the message (or null when it does not apply): one undoable step. */
export async function editTask(id, fn) {
  const rec = taskStore.records.get(id);
  if (!rec) { emit("notice", tt("lost")); return false; }
  const next = structuredClone(rec);
  const msg = fn(next);
  if (msg == null || msg === false) return false;
  next.upd = new Date().toISOString();
  await txn(String(msg).slice(0, 90), async () => { keepTasks(); taskStore.records.set(id, tidyTask(next)); await writeTasks(); });
  return true;
}
/** A new task (fields as in core/tasks.js; state " " unless given, null for an event), linked to the note at `notePath`. */
export async function addTask(fields, { notePath = null, label = "" } = {}) {
  const now = new Date().toISOString();
  const rec = { id: newTaskId(), state: " ", ...fields, created: now, upd: now };
  await txn(label || tt("taskAdded", { title: rec.title }).slice(0, 90), async () => {
    keepTasks();
    if (notePath && vault.notes.has(notePath)) rec.note = await ensureNoteId(notePath);
    taskStore.records.set(rec.id, tidyTask(rec));
    await writeTasks();
  });
  return taskStore.records.get(rec.id);
}
export async function deleteTask(id) {
  const rec = taskStore.records.get(id);
  if (!rec) return false;
  await txn(tt("taskDeleted", { title: rec.title }).slice(0, 90), async () => { keepTasks(); taskStore.records.delete(id); await writeTasks(); });
  return true;
}
/** Link task `id` to the note at `path` (null unlinks it). */
export async function linkTask(id, path) {
  const rec = taskStore.records.get(id);
  if (!rec) return false;
  await txn(path ? tt("taskLinked", { note: vault.notes.get(path)?.name || path }) : tt("taskUnlinked"), async () => {
    keepTasks();
    const next = { ...rec, upd: new Date().toISOString() };
    if (path) next.note = await ensureNoteId(path); else delete next.note;
    taskStore.records.set(id, tidyTask(next));
    await writeTasks();
  });
  return true;
}
/** The note's frontmatter id, given to it now if it has none. */
export async function ensureNoteId(path) {
  const n0 = vault.notes.get(path);
  if (!n0) return null;
  if (n0.fm?.id != null && n0.fm.id !== "") return String(n0.fm.id);
  await emit("flush", path);
  const n = vault.notes.get(path);
  let id = newNoteId();
  while (notePathOf(id)) id = newNoteId();
  await writeRaw(path, withNoteId(n.raw, id));
  ids = null;
  return id;
}

/* ---------- moving tasks out of the notes (once, when a vault from before 0.38 opens, or from the command list) */
/** How many tasks and events the notes still have that belong in tasks.jsonl, and in how many notes. */
export function movableTasks() {
  let tasks = 0, notes = 0;
  for (const n of vault.notes.values()) {
    if (n.raw.length > 400000) continue;
    const c = countMovable(n.raw, n.fm);
    if (c) { tasks += c; notes++; }
  }
  return { tasks, notes };
}
/**
 * Move the notes' tasks and events into tasks.jsonl (core/tasks.js extractTasks), each linked to its note, as one
 * undoable step. A vault on disk keeps each note as it was in .supstack/backup/<time>/ first. A note without an id
 * gets one made from its path, so two devices that do this to the same notes make the same tasks.
 */
export async function moveTasksFromNotes({ backup = true, quiet = false } = {}) {
  await emit("flush");
  const now = new Date(), iso = now.toISOString(), stamp = formatMoment(now, "YYYY-MM-DD HH.mm.ss");
  const r = { tasks: 0, notes: 0, backup: null };
  await txn("", async () => {
    keepTasks();
    for (const n of [...vault.notes.values()]) {
      if (n.raw.length > 400000 || !countMovable(n.raw, n.fm)) continue;
      const has = n.fm?.id != null && n.fm.id !== "";
      const id = has ? String(n.fm.id) : "n" + fnv(n.path);
      const { records, raw } = extractTasks(n.raw, id, { fm: n.fm, now: iso });
      if (!records.length) continue;
      if (backup && vault.fs.kind === "disk") {
        r.backup = `.supstack/backup/${stamp}`;
        try { await vault.fs.write(`${r.backup}/${n.path}`, n.raw); } catch (e) { emit("notice", t("writeFailed", { name: n.path, msg: e.message || e })); throw e; }
      }
      for (const rec of records) if (!taskStore.records.has(rec.id)) taskStore.records.set(rec.id, rec);
      await writeRaw(n.path, has ? raw : withNoteId(raw, id));
      r.tasks += records.length; r.notes++;
    }
    if (r.tasks || !taskStore.exists) await writeTasks();
    return r.tasks && !quiet ? tt("movedTasks", { n: r.tasks }) : "";
  });
  ids = null;
  return r;
}

/* ---------- the archive */
/** Move the tasks closed before today (`days` days ago and earlier) to tasks-archive.jsonl, as one undoable step. */
export async function archiveClosed(days = 1) {
  const T = onow().dn;
  const old = [...taskStore.records.values()].filter((r) => {
    if (r.state == null || taskState(r.state)?.open !== false) return false;
    const c = orgTsParse(r.closed);
    return !c || c.dn <= T - days;
  });
  if (!old.length) { emit("notice", tt("archiveNone")); return 0; }
  const { text: archived } = await readFile(vault.fs, ARCHIVE_PATH);
  const arch = parseTasks(archived);
  await txn(tt("archived", { n: old.length }), async () => {
    keepTasks();
    txnKeep(ARCHIVE_PATH, archived, (text) => writeText(ARCHIVE_PATH, text));
    for (const r of old) { arch.records.set(r.id, r); taskStore.records.delete(r.id); }
    await writeText(ARCHIVE_PATH, serializeTasks(arch.records, arch.extra));
    await writeTasks();
  });
  return old.length;
}

/* ---------- the notes' checklists */
/** The boxes in a note (core/org.js reads them) — its checklist, not tasks of the agenda. */
export const noteBoxes = (note) => orgParse(note).filter((x) => x.isTodo);
/** A card's footer: how many of the note's boxes are ticked (cancelled and forwarded ones don't count). */
export function cardTaskProgress(path) {
  const n = vault.notes.get(path);
  if (!n) return null;
  const es = noteBoxes(n).filter((x) => x.cls !== "cancel" && x.cls !== "fwd");
  return es.length ? { done: es.filter((x) => x.done).length, n: es.length } : null;
}
/** The tasks linked to the note at `path`. */
export const tasksOfNote = (path) => orgAll().filter((e) => e.path === path);
