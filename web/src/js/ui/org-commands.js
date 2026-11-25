/* =========================================================
   Tasks changed from the agenda: state, priority, SCHEDULED / DEADLINE, tags, the title, the note a task belongs to,
   and deleting it — each an undoable change of .supstack/tasks.jsonl (services/tasks.js; core/tasks.js does the record).
   ========================================================= */
import { t, tt } from "../core/i18n.js";
import { baseName, dirName } from "../core/util.js";
import { orgNextState, orgTsStr, TASK_STATES } from "../core/org.js";
import { taskSetPlan, taskSetPriority, taskSetState, taskSetTags, taskShift } from "../core/tasks.js";
import { board, vault } from "../services/state.js";
import { cardIcon } from "../services/vault.js";
import { deleteTask, editTask, linkTask } from "../services/tasks.js";
import { $, h } from "./dom.js";
import { taskIcon } from "./task-icons.js";
import { confirmModal, echo, promptModal, suggestModal } from "./ui.js";
import { orgAskDate } from "./org-editing.js";
import { openEditor } from "./editor.js";

/** t, or a click on the box (`toggle`: ticks an open task, reopens a closed one): [ ] → [/] → [x]. */
export const orgCycle = (e, dir = 1, toggle = false) => (e.kind === "event" ? false : editTask(e.id, (r) => taskSetState(r, toggle ? (e.done ? " " : "x") : orgNextState(e.state, dir))));
export const orgPri = (e, dir, explicit) => (e.kind === "event" ? false : editTask(e.id, (r) => taskSetPriority(r, dir, explicit)));
/** Move a date by `days`: "sched", "dead", or ("ts") an event's. */
export const orgShiftEntry = (e, kind, days) => editTask(e.id, (r) => taskShift(r, kind, days));
export const orgRefocus = () => { if (board.view === "tasks" && !document.activeElement?.closest?.(".sn-editor, input, textarea")) setTimeout(() => $(".ag-body")?.focus({ preventScroll: true }), 0); };
export async function orgPickState(e) {
  if (e.kind === "event") return;
  const ch = await orgPickStateChar(e.state);
  if (ch !== undefined) await editTask(e.id, (r) => taskSetState(r, ch));
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
  await editTask(e.id, (rec) => taskSetPlan(rec, key, r === null ? null : orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep || cur?.rep || null, warn: r.warn || cur?.warn || null })));
}
/** An event's date and time. */
export async function orgWhenEntry(e) {
  const cur = e.stamps[0]?.ts || null;
  const r = await orgAskDate(tt("timestamp"), cur);
  orgRefocus();
  if (!r) return;
  await editTask(e.id, (rec) => { rec.when = orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep || null, warn: null }); return tt("stampTo", { ts: rec.when }); });
}
export async function orgTagsEntry(e) {
  const v = await promptModal(tt("tags"), e.tags.length ? ":" + e.tags.join(":") + ":" : "");
  orgRefocus();
  if (v == null && !e.tags.length) return;
  await editTask(e.id, (r) => taskSetTags(r, String(v || "").split(/[:\s,]+/).filter(Boolean)));
}
export async function orgRenameEntry(e) {
  const v = await promptModal(tt("taskTitle"), e.fullTitle);
  orgRefocus();
  if (v == null || v === e.fullTitle) return;
  await editTask(e.id, (r) => { r.title = v; return tt("taskRenamed"); });
}
export async function orgDeleteEntry(e) {
  const ok = await confirmModal(tt("taskDelete"), e.title, t("delete"));
  orgRefocus();
  if (ok) await deleteTask(e.id);
}
/** The notes a task can link to, the one it links to marked. */
function noteItems(current) {
  return [...vault.notes.keys()].sort((a, b) => baseName(a).localeCompare(baseName(b), undefined, { numeric: true }))
    .map((p) => ({ value: p, title: baseName(p), icon: cardIcon(p) || "file-text", note: dirName(p), checked: p === current }));
}
/** Pick a note for the task, or (the first row) none. */
export async function orgLinkEntry(e) {
  const items = noteItems(e.path);
  if (e.noteId) items.unshift({ value: null, title: tt("taskUnlink"), icon: "unlink" });
  const pick = await suggestModal({ placeholder: tt("taskLinkTo"), items });
  orgRefocus();
  if (pick && pick.value !== e.path) await linkTask(e.id, pick.value);
}
/** Open the note the task belongs to. */
export function orgOpenEntry(e) {
  if (e.path && vault.notes.has(e.path)) { openEditor(e.path, { focus: true, wide: false }); return true; }
  echo(e.noteGone ? tt("noteGoneLong") : tt("noNoteLong"));
  return false;
}
