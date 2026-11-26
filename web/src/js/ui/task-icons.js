/* =========================================================
   The task boxes: one icon per state, drawn instead of the [ ] [/] [<] [x] [-] [>] in the text.
   ========================================================= */
import { tt } from "../core/i18n.js";
import { taskState } from "../core/org.js";
import { h, ic } from "./dom.js";

const DATE_ICON = { dead: "flag", sched: "calendar", closed: "check", event: "calendar-clock" };
/** A task's date as a chip, in the agenda and in a note being read: a deadline is a flag (red when due or overdue, amber
 *  in its warning days), a scheduled date a calendar, a closed one a tick. */
const CHIP_TONE = { due: "is-danger", soon: "is-warn" };
export function dateChip(kind, text, tone = "", title = "") {
  return h("span", { cls: "sn-chip is-s k-" + kind + (tone ? " " + CHIP_TONE[tone] : ""), title: title || null }, DATE_ICON[kind] ? ic("", DATE_ICON[kind]) : null, h("span", { text }));
}

const RING = '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const PATHS = {
  todo: RING,
  doing: RING + '<path d="M8 1.75A6.25 6.25 0 0 0 8 14.25Z" fill="currentColor"/>',
  // an hourglass, not a calendar: the calendar is a scheduled date's chip beside it
  wait: '<path d="M3.75 1.75h8.5M3.75 14.25h8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M4.75 1.75c0 3.25 3.25 4.5 3.25 6.25s-3.25 3-3.25 6.25M11.25 1.75c0 3.25-3.25 4.5-3.25 6.25s3.25 3 3.25 6.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M5.6 14.25c.4-2 2.4-2.75 2.4-2.75s2 .75 2.4 2.75Z" fill="currentColor"/>',
  done: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.9 8.2l2.1 2.1 4.1-4.4" fill="none" stroke="var(--on-accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  cancel: '<path d="M2.5 8h11" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
  fwd: '<path d="M2 2.4 14.2 8 2 13.6 4.3 8Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>',
};
// round everywhere: in notes, on cards and in the agenda
const svg = (id) => `<svg class="task-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${PATHS[id] || PATHS.todo}</svg>`;

/** The state's icon on its own (menus, legends). */
export function taskIcon(ch, cls = "") {
  const id = taskState(ch)?.id || "todo";
  const el = h("span", { cls: `task-icon s-${id}` + (cls ? " " + cls : "") });
  el.innerHTML = svg(id);
  return el;
}
/** A clickable box for a task: a click ticks or reopens it, the context menu picks any state. */
export function taskBox(ch, attrs = {}) {
  const st = taskState(ch) || taskState(" ");
  const name = tt("st_" + st.id);
  const el = h("button", { type: "button", cls: `task-box s-${st.id}`, role: "checkbox", "aria-checked": st.id === "done" ? "true" : st.open ? "false" : "mixed", "aria-label": name, title: name, ...attrs });
  el.dataset.state = st.ch;
  el.innerHTML = svg(st.id);
  return el;
}
