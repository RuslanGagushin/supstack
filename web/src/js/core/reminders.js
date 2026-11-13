/* =========================================================
   Reminders (spec TASK-1, TASK-2): which open tasks should notify, and when — a task whose SCHEDULED or DEADLINE
   date has a time, at that time, repeaters included. services/reminders.js hands them to the system.
   ========================================================= */
import { orgOccursOn, orgSkip, oymd } from "./org.js";

/** A reminder's id: a positive 31-bit number (Android's notification ids are ints), the same for the same task, kind and time. */
export function reminderId(key, kind, at) {
  let h = 0x811c9dc5;
  const s = key + "\u0000" + kind + "\u0000" + at;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h & 0x7fffffff) || 1;
}

/**
 * The reminders due after `now` (ms) and within `days` days, soonest first, at most `limit`.
 * Done, cancelled and forwarded tasks, archived ones and dates without a time give none. A repeating task gives each
 * time it comes round in that span, so a phone that plans them ahead has them all until the app is opened again.
 * `labels`: { sched, dead } — the line under the title. Times are the device's local time, as the note means them.
 */
export function upcomingReminders(entries, now, { days = 14, limit = 64, labels = { sched: "Scheduled", dead: "Deadline" } } = {}) {
  const out = [];
  const d0 = new Date(now);
  const today = Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate()) / 864e5;
  for (const e of entries) {
    if (!e.isTodo || e.done || orgSkip(e)) continue;
    for (const [kind, ts] of [["sched", e.sched], ["dead", e.dead]]) {
      if (!ts?.active || ts.time == null) continue;
      for (let dn = Math.max(today, ts.dn); dn <= today + days; dn++) {
        if (!orgOccursOn(ts, dn)) continue;
        const o = oymd(dn);
        const at = new Date(o.y, o.m - 1, o.d, Math.floor(ts.time / 60), ts.time % 60).getTime();
        if (at <= now) continue;
        out.push({ id: reminderId(e.key, kind, at), at, kind, key: e.key, path: e.path, title: e.title, body: labels[kind] + " · " + String(Math.floor(ts.time / 60)).padStart(2, "0") + ":" + String(ts.time % 60).padStart(2, "0") });
      }
    }
  }
  out.sort((a, b) => a.at - b.at || a.id - b.id);
  return out.slice(0, limit);
}
