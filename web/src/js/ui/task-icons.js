/* =========================================================
   The task boxes: one icon per state, drawn instead of the [ ] [/] [<] [x] [-] [>] in the text.
   ========================================================= */
import { tt } from "../core/i18n.js";
import { taskState } from "../core/org.js";
import { h } from "./dom.js";

const RING = '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const PATHS = {
  todo: RING,
  doing: RING + '<path d="M8 1.75A6.25 6.25 0 0 0 8 14.25Z" fill="currentColor"/>',
  wait: '<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M2.25 5.25a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2V7H2.25Z" fill="currentColor"/>'
    + '<path d="M5.25 1.75v2.5M10.75 1.75v2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  done: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.9 8.2l2.1 2.1 4.1-4.4" fill="none" stroke="var(--task-check, #fff)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  cancel: '<path d="M2.5 8h11" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
  fwd: '<path d="M2 2.4 14.2 8 2 13.6 4.3 8Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>',
};
// in a note's text a box is a rounded square, so an open task does not read as a radio button; the agenda keeps circles
const SQ = '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const SQUARE = {
  todo: SQ,
  doing: SQ + '<path d="M8 2.25H4.75a2.5 2.5 0 0 0-2.5 2.5v6.5a2.5 2.5 0 0 0 2.5 2.5H8Z" fill="currentColor"/>',
  done: '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor"/><path d="M4.9 8.2l2.1 2.1 4.1-4.4" fill="none" stroke="var(--task-check, #fff)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svg = (id, square) => `<svg class="task-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${(square && SQUARE[id]) || PATHS[id] || PATHS.todo}</svg>`;

/** The state's icon on its own (menus, legends). */
export function taskIcon(ch, cls = "") {
  const id = taskState(ch)?.id || "todo";
  const el = h("span", { cls: `task-icon s-${id}` + (cls ? " " + cls : "") });
  el.innerHTML = svg(id);
  return el;
}
/** A clickable box for a task: a click ticks or reopens it, the context menu picks any state. square: the note's own look. */
export function taskBox(ch, attrs = {}, { square = false } = {}) {
  const st = taskState(ch) || taskState(" ");
  const name = tt("st_" + st.id);
  const el = h("button", { type: "button", cls: `task-box s-${st.id}`, role: "checkbox", "aria-checked": st.id === "done" ? "true" : st.open ? "false" : "mixed", "aria-label": name, title: name, ...attrs });
  el.dataset.state = st.ch;
  if (square) el.dataset.shape = "square";
  el.innerHTML = svg(st.id, square);
  return el;
}
