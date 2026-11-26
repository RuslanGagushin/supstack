/* =========================================================
   Quick add: one line of text → a task. "Call Anna fri 14:00 #work @Project X" gives the title "Call Anna", the date
   (core/org.js orgReadDate reads it), the tag "work" and the note "Project X". Pure: the capture form (ui/agenda.js
   orgCapture) highlights the spans this finds and makes the task.
   ========================================================= */
import { norm } from "./util.js";
import { orgReadDate } from "./org.js";

/** A tag after a space or at the start: letters, digits, _ / -, not digits alone (as core/frontmatter.js TAG_RE). */
const TAG_TOKEN_RE = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

// the words a date is made of; a window of them is a date when orgReadDate reads it
const REL = new Set(["today", "tomorrow", "yesterday", "сегодня", "завтра", "вчера", "послезавтра"]);
const WD = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun",
  mon: "mon", tue: "tue", tues: "tue", wed: "wed", thu: "thu", thur: "thu", thurs: "thu", fri: "fri", sat: "sat", sun: "sun",
  понедельник: "mon", вторник: "tue", среда: "wed", среду: "wed", четверг: "thu", пятница: "fri", пятницу: "fri", суббота: "sat", субботу: "sat", воскресенье: "sun",
  пн: "mon", вт: "tue", ср: "wed", чт: "thu", пт: "fri", сб: "sat", вс: "sun" };
const MON_RE = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|январ[яь]|янв|феврал[яь]|фев|марта?|мар|апрел[яь]|апр|мая|июн[яь]|июн|июл[яь]|июл|августа?|авг|сентябр[яь]|сен|октябр[яь]|окт|ноябр[яь]|ноя|декабр[яь]|дек)\.?$/;
const TIME_RE = /^(\d{1,2}:\d{2}(-\d{1,2}:\d{2})?|\d{1,2}(am|pm))$/;
const PREP = new Set(["at", "on", "в", "во"]);

/** What a word is to a date: "strong" (it says a date or a time), "weak" (a day or a year, only beside a strong one)
 *  or null; and the word orgReadDate should get. */
function dateWord(raw) {
  const w = raw.toLowerCase().replace(/ё/g, "е").replace(/,$/, "");
  if (REL.has(w)) return { kind: "strong", w: w === "послезавтра" ? "+2" : w };
  let m;
  if ((m = /^(\d?)([a-zа-я]+)$/.exec(w)) && WD[m[2]]) return { kind: "strong", w: m[1] + WD[m[2]] };
  if (MON_RE.test(w)) return { kind: "strong", w: w.replace(/\.$/, "") };
  if (TIME_RE.test(w)) return { kind: "strong", w };
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(w) || /^\d{1,2}[./]\d{1,2}$/.test(w)) return { kind: "strong", w };
  if (/^(\+|\+\+|\.\+)\d+[dwmyhдн]?$/.test(w)) return { kind: "strong", w };
  if (/^\d{1,2}$/.test(w) || /^\d{4}$/.test(w)) return { kind: "weak", w };
  if (PREP.has(w)) return { kind: "glue", w: "" }; // "завтра в 10:00", "2pm on monday": inside a date, not at its ends
  return null;
}

/**
 * Read a quick-add line.
 * @param {string} text
 * @param {{ notes?: {name: string, path: string}[], keepDate?: string[], base?: number }} [o]
 *   notes: the vault's notes, to find "@Name" (names may have spaces; the longest that fits wins);
 *   keepDate: date phrases the user said are words, not a date (the date chip's ×).
 * @returns {{ title: string, date: null | { start: number, end: number, text: string, r: any },
 *   tags: { start: number, end: number, name: string }[],
 *   note: null | { start: number, end: number, name: string, path: string | null } }}
 *   note.path is null for "@something" no note is called.
 */
export function parseQuickAdd(text, o = {}) {
  const s = String(text || "");
  const notes = (o.notes || []).map((n) => ({ ...n, key: norm(n.name) })).sort((a, b) => b.key.length - a.key.length);
  const keep = new Set((o.keepDate || []).map((x) => x.toLowerCase().trim()));
  const taken = []; // [start, end) spans that are not words of the title
  const tags = [];
  let note = null;
  for (const m of s.matchAll(TAG_TOKEN_RE)) {
    const start = m.index + m[1].length;
    tags.push({ start, end: start + 1 + m[2].length, name: m[2] });
  }
  // @Note name: the longest note name that starts right after the @ and ends at a space, a punctuation mark or the end
  for (const m of s.matchAll(/(^|\s)@/g)) {
    const at = m.index + m[1].length;
    if (tags.some((t) => at >= t.start && at < t.end)) continue;
    const rest = s.slice(at + 1);
    const restKey = norm(rest);
    let hit = null;
    for (const n of notes) {
      if (!n.key || !restKey.startsWith(n.key)) continue;
      const after = rest.charAt(n.name.length);
      if (after && !/[\s,.;:!?]/.test(after)) continue;
      hit = n; break;
    }
    const end = hit ? at + 1 + hit.name.length : at + 1 + (/^[^\s,.;:!?]*/.exec(rest)?.[0].length || 0);
    if (!note) note = { start: at, end, name: hit ? hit.name : s.slice(at + 1, end), path: hit ? hit.path : null };
    taken.push([at, end]);
  }
  for (const t of tags) taken.push([t.start, t.end]);
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);

  // the date: the leftmost, then longest, run of date words that orgReadDate reads
  const words = [...s.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, raw: m[0], d: dateWord(m[0]) }));
  let date = null;
  for (let i = 0; i < words.length && !date; i++) {
    for (let n = Math.min(5, words.length - i); n >= 1; n--) {
      const win = words.slice(i, i + n);
      if (!win.every((w) => w.d && free(w.start, w.end)) || !win.some((w) => w.d.kind === "strong")) continue;
      if (win[0].d.kind === "glue" || win[n - 1].d.kind === "glue") continue;
      const phrase = s.slice(win[0].start, win[n - 1].end);
      if (keep.has(phrase.toLowerCase())) continue;
      const r = orgReadDate(win.map((w) => w.d.w).filter(Boolean).join(" "), o.base);
      if (!r) continue;
      let start = win[0].start;
      const prev = words[i - 1];
      if (prev && PREP.has(prev.raw.toLowerCase()) && free(prev.start, prev.end)) start = prev.start; // "at 14:00", "в пятницу"
      date = { start, end: win[n - 1].end, text: phrase, r };
      break;
    }
  }
  if (date) taken.push([date.start, date.end]);
  let title = "";
  let last = 0;
  for (const [a, b] of taken.sort((x, y) => x[0] - y[0])) { if (a > last) title += s.slice(last, a); last = Math.max(last, b); }
  title += s.slice(last);
  title = title.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:]+|[\s,;:]+$/g, "");
  return { title, date, tags, note };
}

/** The "@" or "#" being typed at `caret`: what comes after it so far, or null. An @ query may have spaces (notes' names do). */
export function quickAddQuery(text, caret) {
  const before = String(text).slice(0, caret);
  const m = /(^|\s)([@#])([^\s@#]*(?: [^\s@#]+)*)$/.exec(before);
  if (!m) return null;
  if (m[2] === "#" && /\s/.test(m[3])) return null;
  if (m[3].length > 60) return null;
  return { kind: m[2] === "@" ? "note" : "tag", start: m.index + m[1].length, query: m[3] };
}
