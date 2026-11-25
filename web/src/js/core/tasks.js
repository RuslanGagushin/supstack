/* =========================================================
   Tasks kept apart from the notes, one JSON object a line in .supstack/tasks.jsonl:

     {"id":"tmhx2k1a9f3","state":" ","pri":"A","title":"Write the report","tags":["work"],
      "sched":"<2026-10-29 Thu 10:00 +1w>","dead":"<2026-10-31 Sat -2d>","note":"n8f3a2c1d","created":"…","upd":"…"}

   - state: the box character of core/org.js TASK_STATES (" ", "/", "<", "x", "-", ">"), or null for an event
   - sched / dead / closed: Org timestamps as core/org.js writes them; when: an event's timestamp(s) ("<…>", "<…>--<…>")
   - note: the `id:` in the frontmatter of the note the task belongs to. The task outlives its note: a note that is
     gone (deleted, or not synced yet) leaves the link in place, and it works again once the note is back.
   The lines are sorted by id, so two devices that each add or change tasks change different lines; git sync merges
   the file by id (tauri-plugin-vault git.rs). A line that is not a task (a half-merged file) is kept as it is.
   This module is the pure part: the file's format, a task as the agenda's entry (the shape core/org.js orgParse
   gives), the edits, and moving tasks out of a note's text. services/tasks.js keeps the file.
   ========================================================= */
import { tt } from "./i18n.js";
import { orgNowTs, orgParse, orgCache, orgShiftRep, orgStamps, orgStripTs, orgTsParse, orgTsStr, OTS_RE, taskState, taskStateName, TASK_STATES } from "./org.js";
import { splitNote, stripCode, TAG_RE } from "./frontmatter.js";

export const TASKS_PATH = ".supstack/tasks.jsonl";
/** Closed tasks moved out of the way (services/tasks.js archiveClosed); the agenda leaves them out. */
export const ARCHIVE_PATH = ".supstack/tasks-archive.jsonl";
/** The fields in the order they are written; fields a later version adds are kept, after these. */
const FIELDS = ["id", "state", "pri", "title", "tags", "sched", "dead", "closed", "when", "note", "created", "upd"];

/** FNV-1a of a string as 8 hex digits. */
export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
/** A new task's id: the time, so ids sort by when tasks were made, and a random tail, so two devices never meet. */
export const newTaskId = (now = Date.now()) => "t" + now.toString(36) + Math.random().toString(36).slice(2, 6).padEnd(4, "0");
/** A note's id for its frontmatter. */
export const newNoteId = () => "n" + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6).padEnd(4, "0");

/** A task as written: the known fields in order, empty ones left out, then any others. */
export function tidyTask(rec) {
  /** @type {any} */
  const out = {};
  for (const k of FIELDS) {
    const v = rec[k];
    if (k === "state") { out.state = v ?? null; continue; }
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(rec)) if (!FIELDS.includes(k) && v !== undefined) out[k] = v;
  return out;
}
/** The file's text → its tasks by id, and the lines that are not tasks (kept as they are). A later line with the same id wins. */
export function parseTasks(text) {
  const records = new Map(), extra = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    /** @type {any} */
    let rec = null;
    try { rec = JSON.parse(line); } catch { /* not a task */ }
    if (rec && typeof rec === "object" && !Array.isArray(rec) && typeof rec.id === "string" && rec.id) {
      if (typeof rec.title !== "string") rec.title = String(rec.title ?? "");
      if (!Array.isArray(rec.tags)) rec.tags = [];
      if (rec.state !== null && !taskState(rec.state)) rec.state = " ";
      records.set(rec.id, rec);
    } else extra.push(line);
  }
  return { records, extra };
}
/** Tasks → the file's text: one line each, sorted by id, then the lines that were not tasks. */
export function serializeTasks(records, extra = []) {
  const recs = [...records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = recs.map((r) => JSON.stringify(tidyTask(r))).concat(extra);
  return lines.length ? lines.join("\n") + "\n" : "";
}

const tagList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : []).map((x) => String(x).replace(/^#/, "")).filter(Boolean);
/**
 * A task as an agenda entry: the fields core/org.js orgParse gives an entry, so the agenda, the calendar export and the
 * reminders read it the same way. `path`: its note's path, or null; `note`: that note ({ name, fm }) when there is one.
 * A task takes its note's tags (as inherited ones) and its `category:`, or its name, for the agenda's column.
 */
export function taskEntry(rec, path = null, note = null) {
  const st = rec.state == null ? null : taskState(rec.state) || TASK_STATES[0];
  const noteTags = note ? tagList(note.fm?.tags) : [];
  const own = [...(rec.tags || []), ...[...stripCode(rec.title || "").matchAll(TAG_RE)].map((x) => x[2])];
  const all = [], seen = new Set();
  for (const tg of [...noteTags, ...own]) { const k = tg.toLowerCase(); if (!seen.has(k)) { seen.add(k); all.push(tg); } }
  const ownSet = new Set(own.map((x) => x.toLowerCase()));
  const title = rec.title || "";
  return {
    key: rec.id, id: rec.id, rec, path, noteId: rec.note || null, noteGone: !!rec.note && !path,
    line: 0, raw: rec.id, kind: st ? "item" : "event", level: 0, indent: 0,
    kw: st?.id ?? null, state: st?.ch ?? null, pri: rec.pri || null, title: orgStripTs(title) || title, fullTitle: title,
    tags: rec.tags || [], alltags: all, inherited: all.filter((x) => !ownSet.has(x.toLowerCase())),
    category: note ? String(note.fm?.category || note.name) : rec.note ? tt("noteGone") : tt("noNote"),
    done: !!st && !st.open, cls: st?.id || "", isTodo: !!st, nested: false,
    sched: orgTsParse(rec.sched), dead: orgTsParse(rec.dead), closed: orgTsParse(rec.closed), stamps: orgStamps(rec.when || ""),
    cbTotal: 0, cbDone: 0, secEnd: 0, outline: [],
  };
}

/* ---------- edits: each changes the task in place and returns the message, or null when it does not apply */
/** Put a task into state `ch`. Closing a repeating task moves it to its next date instead; a task gets `closed` when it
 *  closes and loses it when it opens again (as core/org.js orgSetState does in a note). */
export function taskSetState(rec, ch) {
  const to = taskState(ch);
  if (!to || rec.state == null) return null;
  const from = taskState(rec.state) || TASK_STATES[0];
  if (to.id === "done" && from.open) {
    const s = orgTsParse(rec.sched), d = orgTsParse(rec.dead);
    if (s?.rep || d?.rep) {
      if (d?.rep) rec.dead = orgTsStr(orgShiftRep(d));
      if (s?.rep) rec.sched = orgTsStr(orgShiftRep(s));
      return tt("repeats", { when: s?.rep ? "SCHEDULED: " + rec.sched : "DEADLINE: " + rec.dead });
    }
  }
  rec.state = to.ch;
  if (!to.open && from.open) rec.closed = orgNowTs();
  else if (to.open) delete rec.closed;
  return tt("stateTo", { kw: taskStateName(to.ch) });
}
/** Priority up (dir 1: none → A, B → A) or down (none → C), or `explicit` (null removes it). */
export function taskSetPriority(rec, dir, explicit) {
  const o = rec.pri || null;
  let p;
  if (explicit !== undefined) p = explicit;
  else if (dir > 0) p = o == null ? "A" : o === "A" ? null : String.fromCharCode(o.charCodeAt(0) - 1);
  else p = o == null ? "C" : o === "C" ? null : String.fromCharCode(o.charCodeAt(0) + 1);
  if (p) rec.pri = p; else delete rec.pri;
  return p ? tt("priTo", { p }) : tt("priRemoved");
}
export function taskSetTags(rec, tags) {
  rec.tags = tags.map((x) => String(x).replace(/^#/, "")).filter(Boolean);
  return rec.tags.length ? tt("tagsSet") : tt("tagsRemoved");
}
const PLAN_FIELD = { SCHEDULED: "sched", DEADLINE: "dead" };
/** SCHEDULED or DEADLINE to the timestamp `ts` (a string), or off with null. */
export function taskSetPlan(rec, key, ts) {
  const f = PLAN_FIELD[key];
  if (!f) return null;
  if (ts == null) { delete rec[f]; return tt("planRemoved", { key }); }
  rec[f] = ts;
  return tt("planSet", { key, ts });
}
/** Move a date by n days: "sched", "dead", or ("ts") an event's first timestamp. */
export function taskShift(rec, kind, days) {
  if (kind === "sched" || kind === "dead") {
    const ts = orgTsParse(rec[kind]);
    if (!ts) return null;
    rec[kind] = orgTsStr({ ...ts, dn: ts.dn + days });
    return tt("planSet", { key: kind === "dead" ? "DEADLINE" : "SCHEDULED", ts: rec[kind] });
  }
  const st = orgStamps(rec.when || "")[0];
  if (!st) return null;
  const a = orgTsStr({ ...st.ts, dn: st.ts.dn + days }), b = st.endTs ? orgTsStr({ ...st.endTs, dn: st.endTs.dn + days }) : null;
  rec.when = b ? `${a}--${b}` : a;
  return tt("stampTo", { ts: rec.when });
}

/* ---------- a note's frontmatter id */
/** The note's text with `id: <id>` in its frontmatter, put in as a line so the rest of the frontmatter stays as written. */
export function withNoteId(raw, id) {
  const { fm, body } = splitNote(raw);
  if (!fm) return `---\nid: ${id}\n---\n` + raw;
  const nl = fm.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.split(/\r?\n/);
  const at = lines.findIndex((l, i) => i > 0 && /^id:/.test(l));
  if (at > 0) lines[at] = `id: ${id}`; else lines.splice(1, 0, `id: ${id}`);
  return lines.join(nl) + body;
}

/* ---------- moving tasks out of a note */
/** A task in a note moves to tasks.jsonl when a box in a note can't hold what it has: a date (SCHEDULED, DEADLINE, CLOSED
 *  or one in its text), a priority, or a state other than open [ ] and done [x]. A plain box stays, as a checklist. */
export const taskMoves = (e) => e.isTodo && !!(e.sched || e.dead || e.closed || e.pri || e.stamps.length || (e.kw !== "todo" && e.kw !== "done"));
const lineTs = (stamps) => stamps.map((x) => orgTsStr(x.ts) + (x.endTs ? "--" + orgTsStr(x.endTs) : "")).join(" ");
/**
 * The tasks and events of a note's text as tasks for tasks.jsonl, and the text without them (core/org.js reads them):
 * - a task that moves (taskMoves) leaves the note with its planning line; what was under it (its text, its subtasks)
 *   stays, one level out
 * - an event (a line with a date) stays as text without its date, and its date goes to an event in tasks.jsonl
 * Plain boxes stay where they are. `noteId` links the tasks to the note; `now` is when they are made. The ids come from
 * the note's id and the line, so two devices that move the same note's tasks make the same tasks, which merge.
 * Returns { records, raw } (raw is the text unchanged when nothing moved).
 * @param {string} raw @param {string} noteId @param {{ fm?: any, now?: string }} [opts]
 */
export function extractTasks(raw, noteId, { fm = {}, now = new Date().toISOString() } = {}) {
  const key = "\u0001extract";
  orgCache.delete(key);
  const entries = orgParse({ path: key, raw, fm, name: "" });
  orgCache.delete(key);
  const lines = raw.split("\n");
  const fileTags = new Set(tagList(fm.tags).map((x) => x.toLowerCase()));
  const drop = new Set(), dedent = new Array(lines.length).fill(0), seen = new Map(), records = [];
  const idOf = (text) => { const n = (seen.get(text) || 0) + 1; seen.set(text, n); return "m" + fnv(noteId + "\u0000" + text + "\u0000" + n) + fnv(text + "\u0000" + n).slice(0, 3); };
  for (const e of entries) {
    if (e.kind === "event") {
      const when = lineTs(e.stamps);
      if (!when) continue;
      const inline = new Set([...stripCode(e.fullTitle).matchAll(TAG_RE)].map((x) => x[2].toLowerCase()));
      records.push(tidyTask({ id: idOf(lines[e.line]), state: null, pri: e.pri, title: e.title, tags: e.alltags.filter((x) => !fileTags.has(x.toLowerCase()) && !inline.has(x.toLowerCase())), when, note: noteId, created: now, upd: now }));
      lines[e.line] = lines[e.line].replace(OTS_RE(), (m, o) => (o === "<" ? "" : m)).replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ").replace(/[ \t]+$/, "");
      continue;
    }
    if (!taskMoves(e)) continue;
    const inline = new Set([...stripCode(e.fullTitle).matchAll(TAG_RE)].map((x) => x[2].toLowerCase()));
    records.push(tidyTask({
      id: idOf(e.raw), state: e.state, pri: e.pri, title: e.title,
      tags: e.alltags.filter((x) => !fileTags.has(x.toLowerCase()) && !inline.has(x.toLowerCase())),
      sched: e.sched ? orgTsStr(e.sched) : null, dead: e.dead ? orgTsStr(e.dead) : null, closed: e.closed ? orgTsStr(e.closed) : null,
      when: e.stamps.length ? lineTs(e.stamps) : null, note: noteId, created: now, upd: now,
    }));
    drop.add(e.line);
    if (e.planLine != null) drop.add(e.planLine);
    const m = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/.exec(e.raw);
    const step = m ? m[2].length + 1 : 2;
    for (let i = e.line + 1; i < e.secEnd && i < lines.length; i++) dedent[i] += step;
  }
  if (!records.length) return { records, raw };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    let L = lines[i];
    if (dedent[i] && L.trim()) {
      const lead = /^[ \t]*/.exec(L)[0];
      let w = 0, k = 0;
      while (k < lead.length && w < dedent[i]) { w += lead[k] === "\t" ? 4 : 1; k++; }
      L = " ".repeat(Math.max(0, w - dedent[i])) + L.slice(k);
    }
    out.push(L);
  }
  // a heading's or a list's tasks all gone: no run of blank lines left in their place
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { records, raw: text };
}
/** How many tasks and events would move out of a note's text. @param {string} raw @param {any} [fm] */
export function countMovable(raw, fm = {}) {
  const key = "\u0001count";
  orgCache.delete(key);
  const entries = orgParse({ path: key, raw, fm, name: "" });
  orgCache.delete(key);
  return entries.filter((e) => (e.kind === "event" ? e.stamps.length > 0 : taskMoves(e))).length;
}
/** The boxes in a note's text: how many there are and how many are ticked (a checklist's progress). */
export function noteChecklist(raw) {
  const key = "\u0001checklist";
  orgCache.delete(key);
  const boxes = orgParse({ path: key, raw, fm: {}, name: "" }).filter((e) => e.isTodo && e.cls !== "cancel" && e.cls !== "fwd");
  orgCache.delete(key);
  return { n: boxes.length, done: boxes.filter((e) => e.done).length };
}
