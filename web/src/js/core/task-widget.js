import { orgDayEntries, oymd } from "./org.js";
import { plainText } from "./util.js";

/** The widget shows one row per open task, with overdue rows taking precedence. */
export function widgetDays(entries, today) {
  const tasks = entries.filter((entry) => entry.isTodo && !entry.done);
  const days = {};
  for (let day = today; day < today + 7; day++) {
    const { y, m, d } = oymd(day);
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const overdue = new Map(), current = new Map();
    for (const row of orgDayEntries(day, tasks, day)) {
      if (row.soon != null || (row.kind !== "sched" && row.kind !== "dead")) continue;
      const section = row.overdue ? overdue : current;
      // the widget shows plain text: no link syntax, emphasis or the #tags that end a title
      if (!section.has(row.e.id)) section.set(row.e.id, { id: row.e.id, title: plainText(row.e.title, 500) || row.e.title });
    }
    for (const id of overdue.keys()) current.delete(id);
    days[date] = { overdue: [...overdue.values()], today: [...current.values()] };
  }
  return days;
}
