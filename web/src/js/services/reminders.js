/* =========================================================
   Reminders as system notifications (spec TASK-1, TASK-2, TASK-3): core/reminders.js says which tasks should
   notify and when; this hands them to the system.
   - Android: each one is scheduled with the system ahead of time, so it comes with the app closed.
   - Desktop app and browser: a timer while the page is open; the next 24 hours, planned again every hour.
   They are planned again a little after any change to the notes: a save, a change on disk, a sync.
   Permission is asked for once, when the vault first has a task with a time, never at start-up; without it the app
   works as before. A demo or a copy of a vault has nothing to remind of.
   ========================================================= */
import { tt } from "../core/i18n.js";
import { upcomingReminders } from "../core/reminders.js";
import { lsGet, lsSet } from "./storage.js";
import { on } from "./events.js";
import { IS_ANDROID, IS_NATIVE, TAURI } from "./native.js";
import { vault } from "./state.js";
import { orgAll } from "./tasks.js";

const ASKED = "sn-reminders-asked"; // the answer, once permission was asked for
const PLANNED = "sn-reminders-planned"; // Android: the ids scheduled with the system
const DAY = 86400000, HOUR = 3600000;
/** What was planned last, for the page and the tests. */
export const reminders = { permission: null, planned: [] };
let timers = [];
let debounce = null;
let hourly = null;

const notifyInvoke = (cmd, args) => TAURI.invoke("plugin:notification|" + cmd, args);
const label = (k) => tt(k).replace(/:$/, "");

/** May the app notify? Asks the first time only; "granted" or "denied". */
async function permission() {
  if (IS_NATIVE) {
    const g = await notifyInvoke("is_permission_granted").catch(() => false);
    if (g === true) return "granted";
    if (g === false) return "denied";
    const asked = lsGet(ASKED, null); // the answer given before, when the system can't say
    if (asked) return asked === "granted" ? "granted" : "denied";
    const r = await notifyInvoke("request_permission").catch(() => "denied");
    lsSet(ASKED, String(r));
    return r === "granted" ? "granted" : "denied";
  }
  if (typeof window.Notification !== "function") return "denied";
  if (window.Notification.permission !== "default") return window.Notification.permission === "granted" ? "granted" : "denied";
  const asked = lsGet(ASKED, null);
  if (asked) return asked === "granted" ? "granted" : "denied";
  const r = await window.Notification.requestPermission().catch(() => "denied");
  lsSet(ASKED, String(r));
  return r === "granted" ? "granted" : "denied";
}
function show(r) {
  if (IS_NATIVE) notifyInvoke("notify", { options: { id: r.id, title: r.title, body: r.body } }).catch((e) => console.warn("reminder not shown", e));
  else if (typeof window.Notification === "function") { try { new window.Notification(r.title, { body: r.body, tag: String(r.id) }); } catch (e) { console.warn("reminder not shown", e); } }
}
/** Android: schedule what is new, cancel what is gone. */
async function scheduleOnAndroid(list) {
  const before = new Set(lsGet(PLANNED, []) || []), now = new Set(list.map((r) => r.id));
  const gone = [...before].filter((id) => !now.has(id));
  if (gone.length) await notifyInvoke("cancel", { notifications: gone }).catch((e) => console.warn("reminders not cancelled", e));
  const kept = [...before].filter((id) => now.has(id));
  for (const r of list) {
    if (before.has(r.id)) continue;
    try {
      await notifyInvoke("notify", { options: { id: r.id, title: r.title, body: r.body, schedule: { at: { date: new Date(r.at).toISOString(), repeating: false, allowWhileIdle: true } } } });
      kept.push(r.id);
    } catch (e) { console.warn("reminder not scheduled", e); }
  }
  lsSet(PLANNED, kept);
}
async function cancelAll() {
  timers.forEach(clearTimeout); timers = [];
  reminders.planned = [];
  const planned = IS_ANDROID ? lsGet(PLANNED, []) || [] : [];
  if (planned.length) { await notifyInvoke("cancel", { notifications: planned }).catch(() => {}); lsSet(PLANNED, []); }
}

/** Plan the reminders of the open vault from scratch; returns what is planned. */
export async function planReminders() {
  clearTimeout(debounce); debounce = null;
  if (!vault.fs || vault.fs.kind !== "disk") { await cancelAll(); return []; }
  const list = upcomingReminders(orgAll(), Date.now(), { labels: { sched: label("lScheduled"), dead: label("lDeadline") } });
  if (!list.length) { await cancelAll(); return []; }
  reminders.permission = await permission();
  timers.forEach(clearTimeout); timers = [];
  if (reminders.permission !== "granted") { reminders.planned = []; return []; }
  if (IS_ANDROID) await scheduleOnAndroid(list);
  else {
    for (const r of list) {
      const wait = r.at - Date.now();
      if (wait > 0 && wait <= DAY) timers.push(setTimeout(() => show(r), wait));
    }
    // timers reach a day ahead: plan again every hour, for what comes into range and for a clock that jumped
    if (!hourly) hourly = setInterval(() => planReminders(), HOUR);
  }
  reminders.planned = list;
  return list;
}
/** Plan again a little after the notes change, so a burst of edits is one plan. */
export function replanSoon(ms = 2000) {
  clearTimeout(debounce);
  debounce = setTimeout(() => planReminders(), ms);
}
on("opened", () => replanSoon(0));
on("changed", () => replanSoon());
on("written", () => replanSoon());
