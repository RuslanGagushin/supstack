/* =========================================================
   Tasks changed from the agenda and the editor's commands: state, priority,
   SCHEDULED / DEADLINE and tags, each an undoable edit of the note (core/org.js does the text).
   ========================================================= */
import { tt } from "../core/i18n.js";
import { orgNextState, orgSetPlanning, orgSetPriority, orgSetState, orgSetTags, orgTsStr, TASK_STATES } from "../core/org.js";
import { board, editor, vault } from "../services/state.js";
import { txn, writeRaw } from "../services/save.js";
import { $, h } from "./dom.js";
import { taskIcon } from "./task-icons.js";
import { echo, promptModal, suggestModal } from "./ui.js";
import { saveEditor } from "./editor.js";
import { orgAskDate } from "./org-editing.js";

/* ---------- calendar arithmetic on day numbers (local calendar dates) */

/* ---------- timestamps: <2026-10-28 Wed 10:00-11:00 +1w -2d>  (active)  [..] (inactive) */


/* ---------- keywords */

/* ---------- line grammar */

/* ---------- parsing a note into entries (cached per text) */

/* ---------- editing entries in notes (undoable, synced) */
export async function orgEdit(e, fn) {
  if (editor.path === e.path && editor.dirty) await saveEditor();
  const n = vault.notes.get(e.path);
  if (!n) return false;
  const lines = n.raw.split("\n");
  let li = e.line;
  if (lines[li] !== e.raw) { li = lines.indexOf(e.raw); if (li < 0) { echo(tt("lost")); return false; } }
  const msg = fn(lines, li);
  if (msg == null || msg === false) return false;
  await txn(String(msg).slice(0, 90), () => writeRaw(e.path, lines.join("\n")));
  return true;
}
/** Ctrl+Enter or t: the next state in [ ] → [/] → [x]; `toggle` (a click on the box) ticks an open task and reopens a closed one. */
export const orgCycle = (e, dir = 1, toggle = false) => (e.kind === "event" ? false : orgEdit(e, (L, li) => orgSetState(L, li, toggle ? (e.done ? " " : "x") : orgNextState(e.state, dir))));
export const orgPri = (e, dir, explicit) => (e.kind === "event" ? false : orgEdit(e, (L, li) => orgSetPriority(L, li, dir, explicit)));
export const orgRefocus = () => { if (board.view === "tasks" && !document.activeElement?.closest?.(".sn-editor, input, textarea")) setTimeout(() => $(".ag-body")?.focus({ preventScroll: true }), 0); };
export async function orgPickState(e) {
  if (e.kind === "event") return;
  const ch = await orgPickStateChar(e.state);
  if (ch !== undefined) await orgEdit(e, (L, li) => orgSetState(L, li, ch));
  orgRefocus();
}
/** The state menu: the six states with their icons. Resolves to the box character, or undefined when dismissed. */
export async function orgPickStateChar(cur) {
  const it = await suggestModal({
    placeholder: tt("pickState"), current: cur === "X" ? "x" : cur,
    items: TASK_STATES.map((s) => ({ title: tt("st_" + s.id), value: s.ch, keywords: s.id })),
    render: (x) => h("div", {}, taskIcon(x.value, "suggestion-icon"), h("span", { cls: "suggestion-title", text: x.title }), h("span", { cls: "suggestion-note", text: `[${x.value}]` })),
  });
  return it ? it.value : undefined;
}
export async function orgPickPriority(cur) {
  const it = await suggestModal({ placeholder: tt("priority"), items: [["A", "chevrons-up"], ["B", "chevron-up"], ["C", "chevron-down"], ["—", "minus"]].map(([p, icon]) => ({ title: p, icon, p: p === "—" ? null : p, note: cur === p ? "●" : "" })) });
  return it ? it.p : undefined;
}
export async function orgPlanEntry(e, key) {
  const cur = key === "SCHEDULED" ? e.sched : e.dead;
  const r = await orgAskDate(key === "SCHEDULED" ? tt("schedule") : tt("deadline"), cur);
  orgRefocus();
  if (r === undefined) return;
  await orgEdit(e, (L, li) => {
    if (r === null) { orgSetPlanning(L, li, key, null); return tt("planRemoved", { key }); }
    const ts = orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep || cur?.rep || null, warn: r.warn || cur?.warn || null });
    orgSetPlanning(L, li, key, ts);
    return tt("planSet", { key, ts });
  });
}
export async function orgTagsEntry(e) {
  if (e.kind === "event") return;
  const v = await promptModal(tt("tags"), e.tags.length ? ":" + e.tags.join(":") + ":" : "");
  orgRefocus();
  if (v == null && !e.tags.length) return;
  const tags = String(v || "").split(/[:\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
  await orgEdit(e, (L, li) => orgSetTags(L, li, tags));
}

