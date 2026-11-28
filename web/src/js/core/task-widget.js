import { orgDayEntries, oymd } from "./org.js";
import { plainText } from "./util.js";

/** The days the widget can show without the app: Today needs one, Upcoming a week from it. */
export const WIDGET_DAYS = 14;

/** One row: the task's id and plain title, and when present its time (minutes), end, priority and note's name. */
function widgetRow(row, noteName) {
  const e = row.e;
  // the widget shows plain text: no link syntax, emphasis or the #tags that end a title
  const out = { id: e.id, title: plainText(e.title, 500) || e.title };
  if (row.time != null) out.time = row.time;
  if (row.time != null && row.end != null) out.end = row.end;
  if (e.pri) out.pri = e.pri;
  const note = noteName(e);
  if (note) out.note = note;
  return out;
}

/** The widget shows one row per open task, with overdue rows taking precedence.
 *  `noteName(entry)`: the name of the note the task belongs to, or null. */
export function widgetDays(entries, today, noteName = () => null) {
  const tasks = entries.filter((entry) => entry.isTodo && !entry.done);
  const days = {};
  for (let day = today; day < today + WIDGET_DAYS; day++) {
    const { y, m, d } = oymd(day);
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const overdue = new Map(), current = new Map();
    for (const row of orgDayEntries(day, tasks, day)) {
      if (row.soon != null || (row.kind !== "sched" && row.kind !== "dead")) continue;
      const section = row.overdue ? overdue : current;
      if (!section.has(row.e.id)) section.set(row.e.id, widgetRow(row, noteName));
    }
    for (const id of overdue.keys()) current.delete(id);
    days[date] = { overdue: [...overdue.values()], today: [...current.values()] };
  }
  return days;
}
