/* =========================================================
   The vault's dated tasks as a calendar file (spec TASK-7): iCalendar (RFC 5545) that a calendar app imports.
   Open tasks with an active SCHEDULED or DEADLINE date, and events (lines with an active timestamp). Export only:
   nothing comes back from the calendar.
   ========================================================= */
import { orgSkip, oymd } from "./org.js";

const RRULE_FREQ = { h: "HOURLY", d: "DAILY", w: "WEEKLY", m: "MONTHLY", y: "YEARLY" };
const pad = (n, w = 2) => String(n).padStart(w, "0");

/** A day number (core/org.js) as YYYYMMDD. */
const icsDate = (dn) => { const o = oymd(dn); return `${pad(o.y, 4)}${pad(o.m)}${pad(o.d)}`; };
/** A timestamp's start, or with `min` another time that day: a date, or a date and time in the calendar's own zone. */
function icsStart(dn, min) {
  return min == null ? `;VALUE=DATE:${icsDate(dn)}` : `:${icsDate(dn)}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
}
/** Text in a property value: backslash, semicolon, comma and line breaks escaped. */
export const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** A content line folded at 75 bytes, as the format asks: the rest goes on lines that start with a space. */
export function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
/** A title as a calendar shows it: [[links]] as their text, the way the list reads them. */
const plainTitle = (s) => s.replace(/\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, (m, a, b) => b || a.split("#")[0]).trim();
/** FNV-1a of a string, as 8 hex digits: a UID that stays the same while the task stays on its line. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * The calendar file for `entries` (core/org.js orgParse results).
 * - now: when the file is made (DTSTAMP)
 * - labels: { deadline } — the word before a deadline's title
 */
export function tasksToIcs(entries, { now = new Date(), labels = { deadline: "Deadline" } } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Supstack//Tasks//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Supstack"];
  const add = (e, kind, title, ts, endTs) => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${hash(e.key + "\u0000" + kind + "\u0000" + ts.dn)}-${kind}@supstack`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push("DTSTART" + icsStart(ts.dn, ts.time));
    // the end: a range's second date, a time range's end, or the next day for a whole day
    if (endTs) lines.push("DTEND" + (ts.time == null ? `;VALUE=DATE:${icsDate(endTs.dn + 1)}` : icsStart(endTs.dn, endTs.time ?? ts.time)));
    else if (ts.time != null && ts.end != null) lines.push("DTEND" + icsStart(ts.dn, ts.end));
    else if (ts.time == null) lines.push(`DTEND;VALUE=DATE:${icsDate(ts.dn + 1)}`);
    if (ts.rep && ts.rep.n > 0 && RRULE_FREQ[ts.rep.u]) lines.push(`RRULE:FREQ=${RRULE_FREQ[ts.rep.u]};INTERVAL=${ts.rep.n}`);
    lines.push(`SUMMARY:${icsText(plainTitle(title))}`);
    lines.push(`DESCRIPTION:${icsText(e.path)}`);
    if (e.alltags?.length) lines.push(`CATEGORIES:${e.alltags.map(icsText).join(",")}`);
    if (e.pri) lines.push(`PRIORITY:${{ A: 1, B: 5, C: 9 }[e.pri] ?? 5}`);
    lines.push("END:VEVENT");
  };
  let n = 0;
  for (const e of entries) {
    if (orgSkip(e)) continue;
    if (e.isTodo) {
      if (e.done) continue;
      if (e.sched?.active) { add(e, "sched", e.title, e.sched); n++; }
      if (e.dead?.active) { add(e, "dead", `${labels.deadline}: ${e.title}`, e.dead); n++; }
    } else if (e.kind === "event") {
      e.stamps.forEach((st, i) => { add(e, "ts" + i, e.title, st.ts, st.endTs); n++; });
    }
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(icsFold).join("\r\n") + "\r\n", events: n };
}
