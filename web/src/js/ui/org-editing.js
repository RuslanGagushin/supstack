import { ct, ft, LANG, t, tt } from "../core/i18n.js";
import { debounce } from "../core/util.js";
import { splitNote } from "../core/frontmatter.js";
import { oaddMonths, odn, oFmt, ohm, oIndentW, oisoWeek, onow, opad, OPLAN_RE, orgHead, orgLine, orgNextState, orgPlanMap, orgReadDate, orgRelDay, orgWarnDays, orgSetPlanning, orgSetPriority, orgSetState, orgSetTags, orgSkip, orgTsParse, orgTsStr, oymd, taskStateName } from "../core/org.js";
import { lsGet, lsSet } from "../services/storage.js";
import { editor, vault } from "../services/state.js";
import { orgAll } from "../services/tasks.js";
import { $, $$, h, ic, isMod, setIcon } from "./dom.js";
import { defaultEcho, echo, promptPanel, promptModal } from "./ui.js";
import { openEditor } from "./editor.js";
import { liveActivate, liveText } from "./live-preview.js";
import { edInsert, updateEdToolbar } from "./editor-toolbar.js";
import { caretRect } from "./completion.js";
import { orgPickPriority } from "./org-commands.js";
import { dateChip } from "./task-icons.js";
import { openTasksView, orgCapture } from "./agenda.js";

/* ---------- calendar popup (date + time + repeat), used by every date prompt and by Capture */
/** Text the date reader understands, e.g. "2026-11-05 14:00-15:00 +1w". */
export function orgDateText(r) {
  if (!r) return "";
  const o = oymd(r.dn);
  let s = `${o.y}-${opad(o.m)}-${opad(o.d)}`;
  if (r.time != null) { s += " " + ohm(r.time); if (r.end != null) s += "-" + ohm(r.end); }
  if (r.rep) s += ` ${r.rep.type}${r.rep.n}${r.rep.u}`;
  if (r.warn) s += ` ${r.warn.first ? "--" : "-"}${r.warn.n}${r.warn.u}`;
  return s;
}
/** A month calendar with time and repeat controls. opts: { value, base, dateOnly, onChange(r), onAccept(r), onClear } */
export function orgCalendar(opts) {
  const T = onow().dn;
  const st = { dn: opts.value?.dn ?? null, time: opts.value?.time ?? null, end: opts.value?.end ?? null, rep: opts.value?.rep ?? null, warn: opts.value?.warn ?? null };
  let view = st.dn ?? opts.base ?? T;
  const marks = new Map();
  try {
    for (const e of orgAll()) {
      if (e.done || orgSkip(e)) continue;
      for (const ts of [e.sched, e.dead, ...e.stamps.map((x) => x.ts)]) if (ts?.active) marks.set(ts.dn, (marks.get(ts.dn) || 0) + 1);
    }
  } catch { /* no dates to mark */ }
  const el = h("div", { cls: "org-cal", role: "group", "aria-label": LANG === "ru" ? "Календарь" : "Calendar" });
  el.addEventListener("mousedown", (e) => { if (!e.target.closest("input, select")) e.preventDefault(); }); // keep focus in the text field
  const value = () => (st.dn == null ? null : { dn: st.dn, time: st.time, end: st.end, rep: st.rep, warn: st.warn });
  const changed = () => { render(); opts.onChange?.(value()); };
  const wdFmt = new Intl.DateTimeFormat(LANG === "ru" ? "ru" : "en", { weekday: "short", timeZone: "UTC" });
  const head = h("div", { cls: "cal-head" });
  const grid = h("div", { cls: "cal-grid", role: "grid" });
  const quick = h("div", { cls: "cal-quick" });
  const foot = h("div", { cls: "cal-foot" });
  el.append(head, grid, quick);
  // time + repeat controls (built once so typing in them is not interrupted): a labelled row each, the time typed as text
  // ("14", "14:30", "1430", "2pm"), the end only once there is a start
  const field = (cls, label) => h("input", { type: "text", cls: "cal-t " + cls, placeholder: label, "aria-label": label, spellcheck: "false", autocomplete: "off" });
  const tIn = field("is-start", ct("addTime"));
  const eIn = field("is-end", ct("endTime"));
  const endPart = h("span", { cls: "cal-end" }, h("span", { cls: "cal-dash", text: "–" }), eIn);
  const rep = h("select", { cls: "cal-rep", "aria-label": ct("repeat") }, h("option", { value: "", text: ct("none") }),
    ...["d", "w", "m", "y"].map((u) => h("option", { value: "+1" + u, text: ct("every")[u] })));
  const toMin = (v) => {
    const m = /^\s*(\d{1,2})(?:[:.\s]?(\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(v || "") || /^\s*(\d{1,2})(?:[:.\s]?(\d{2}))?()\s*$/.exec(v || "");
    if (!m) return undefined;
    let hh = +m[1];
    const mm = m[2] ? +m[2] : 0, ap = (m[3] || "").toLowerCase();
    if (ap) { if (hh < 1 || hh > 12) return undefined; hh = (hh % 12) + (ap === "p" ? 12 : 0); }
    return hh > 23 || mm > 59 ? undefined : hh * 60 + mm;
  };
  /** The typed time, or null for an empty field; a time it can't read is marked and changes nothing. */
  const readTime = (x) => {
    const v = x.value.trim();
    const m = v ? toMin(v) : null;
    x.classList.toggle("is-bad", m === undefined);
    return m;
  };
  for (const x of [tIn, eIn]) {
    x.addEventListener("keydown", (e) => { if (e.key === "Enter") x.dispatchEvent(new Event("change")); });
    x.addEventListener("input", () => x.classList.remove("is-bad"));
  }
  tIn.addEventListener("change", () => { const m = readTime(tIn); if (m === undefined) return; st.time = m; if (m == null) st.end = null; if (st.dn == null) st.dn = T; changed(); });
  eIn.addEventListener("change", () => { const m = readTime(eIn); if (m === undefined) return; st.end = st.time == null || m == null || m <= st.time ? null : m; changed(); });
  rep.addEventListener("change", () => { const m = /^\+(\d+)([dwmy])$/.exec(rep.value); st.rep = m ? { type: st.rep?.type || "+", n: +m[1], u: m[2] } : null; if (st.dn == null) st.dn = T; changed(); });
  const noTime = LANG === "ru" ? "Без времени" : "No time";
  const clearT = h("button", { type: "button", cls: "cal-x", title: noTime, "aria-label": noTime }, ic("", "x"));
  clearT.addEventListener("click", () => { st.time = st.end = null; tIn.value = eIn.value = ""; changed(); });
  if (!opts.dateOnly) {
    el.append(h("div", { cls: "cal-opts" },
      h("div", { cls: "cal-field" }, h("span", { cls: "cal-label" }, ic("cal-ico", "clock"), h("span", { text: ct("time") })), h("span", { cls: "cal-ctl" }, tIn, endPart, clearT)),
      h("div", { cls: "cal-field" }, h("span", { cls: "cal-label" }, ic("cal-ico", "repeat"), h("span", { text: ct("repeat") })), h("span", { cls: "cal-ctl" }, rep))));
  }
  el.append(foot);
  function render() {
    const o = oymd(view);
    const first = odn(o.y, o.m, 1);
    const start = first - ((oymd(first).w + 6) % 7);
    const prev = h("button", { type: "button", cls: "cal-nav", title: ct("prevM"), "aria-label": ct("prevM") }, ic("", "chevron-left"));
    const next = h("button", { type: "button", cls: "cal-nav", title: ct("nextM"), "aria-label": ct("nextM") }, ic("", "chevron-right"));
    prev.addEventListener("click", () => { view = oaddMonths(first, -1); render(); });
    next.addEventListener("click", () => { view = oaddMonths(first, 1); render(); });
    // the month on the left, as the list's title; a click on it comes back to this month
    const title = h("button", { type: "button", cls: "cal-title", title: tt("today"), text: oFmt(first, "MMMM YYYY") });
    title.addEventListener("click", () => { view = T; render(); });
    head.replaceChildren(title, prev, next);
    grid.replaceChildren(h("span", { cls: "cal-wk-h", text: "" }), ...Array.from({ length: 7 }, (_, i) => h("span", { cls: "cal-wd" + (i >= 5 ? " is-weekend" : ""), text: wdFmt.format(new Date((start + i) * 864e5)).replace(/\.$/, "") })));
    for (let r = 0; r < 6; r++) {
      const rowStart = start + r * 7;
      if (r === 5 && oymd(rowStart).m !== o.m) break;
      grid.append(h("span", { cls: "cal-wk", text: String(oisoWeek(rowStart)) }));
      for (let i = 0; i < 7; i++) {
        const dn = rowStart + i, d = oymd(dn);
        const b = h("button", { type: "button", role: "gridcell", cls: "cal-day" + (d.m !== o.m ? " is-out" : "") + (i >= 5 ? " is-weekend" : "") + (dn === T ? " is-today" : "") + (dn === st.dn ? " is-sel" : ""),
          "aria-selected": String(dn === st.dn), "aria-label": oFmt(dn, "dddd D MMMM YYYY"), title: marks.get(dn) ? `${oFmt(dn, "ddd D MMM")} · ${marks.get(dn)}` : oFmt(dn, "ddd D MMM") }, String(d.d), marks.get(dn) ? h("i", { cls: "cal-dot" }) : null);
        b.addEventListener("click", () => { st.dn = dn; view = dn; changed(); });
        b.addEventListener("dblclick", () => { st.dn = dn; opts.onAccept?.(value()); });
        grid.append(b);
      }
    }
    const nextMon = T + (((8 - oymd(T).w) % 7) || 7);
    const qb = (text, dn) => { const b = h("button", { type: "button", cls: "cal-q" + (st.dn === dn ? " is-on" : ""), text }); b.addEventListener("click", () => { st.dn = dn; view = dn; changed(); }); return b; };
    quick.replaceChildren(qb(tt("today"), T), qb(ct("tomorrow"), T + 1), qb(ct("nextMon"), nextMon), qb(ct("nextWeek"), T + 7));
    foot.replaceChildren();
    if (opts.onClear) { const c = h("button", { type: "button", cls: "cal-q is-clear", text: ct("clear") }); c.addEventListener("click", () => opts.onClear()); foot.append(c); }
    if (opts.onAccept) { const ok = h("button", { type: "button", cls: "cal-ok", text: ct("ok"), disabled: st.dn == null }); ok.addEventListener("click", () => st.dn != null && opts.onAccept(value())); foot.append(ok); }
    if (document.activeElement !== tIn) { tIn.value = st.time == null ? "" : ohm(st.time); tIn.classList.remove("is-bad"); }
    if (document.activeElement !== eIn) { eIn.value = st.end == null ? "" : ohm(st.end); eIn.classList.remove("is-bad"); }
    endPart.hidden = st.time == null;
    clearT.hidden = st.time == null;
    const rv = st.rep && st.rep.n === 1 ? "+1" + st.rep.u : "";
    if (st.rep && !rv) { if (!rep.querySelector(".is-custom")) rep.append(h("option", { cls: "is-custom", value: "custom", text: `${st.rep.type}${st.rep.n}${st.rep.u}` })); rep.value = "custom"; }
    else { rep.querySelector(".is-custom")?.remove(); rep.value = rv; }
  }
  render();
  return {
    el,
    /** Update from typed text without echoing back. */
    set(r) { if (!r) return; Object.assign(st, { dn: r.dn, time: r.time ?? null, end: r.end ?? null, rep: r.rep ?? null, warn: r.warn ?? st.warn }); view = r.dn; render(); },
    move(days) { st.dn = (st.dn ?? T) + days; view = st.dn; changed(); },
    month(n) { view = oaddMonths(odn(oymd(view).y, oymd(view).m, 1), n); render(); },
    value,
  };
}

/** Date prompt: a popup with a live preview and the calendar under the field. undefined = cancelled, null = remove ("-"). */
export function orgAskDate(label, cur, o = {}) {
  return new Promise((resolve) => {
    const prev = h("div", { cls: "prompt-preview" });
    const merge = (r) => (r ? { ...r, rep: r.rep || (o.dateOnly ? null : cur?.rep) || null, warn: r.warn || cur?.warn || null } : r);
    let input;
    const cal = orgCalendar({
      value: cur ? { dn: cur.dn, time: cur.time, end: cur.end, rep: cur.rep, warn: cur.warn } : { dn: onow().dn }, base: cur?.dn, dateOnly: o.dateOnly,
      onChange: (r) => { input.value = orgDateText(r); show(); },
      onAccept: (r) => finish(r),
      onClear: cur && !o.dateOnly ? () => finish(null) : null,
    });
    const p = promptPanel(label, {
      placeholder: tt("dateHelp"), extra: [prev, h("div", { cls: "prompt-cal" }, cal.el)], onClose: (v) => resolve(v),
      keys: [["↵", t("confirm")], ["Shift+←→↑↓", tt("calMove")], ["PgUp/PgDn", tt("calMonth")], ["esc", t("dismiss")]],
    });
    input = p.input;
    const finish = (v) => p.close(v);
    cal.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); const r = cal.value(); if (r) finish(r); }
    });
    function show() {
      const v = input.value.trim();
      if (v === "-") { prev.textContent = "→ —"; prev.classList.remove("is-bad"); return; }
      const r = merge(orgReadDate(v, cur?.dn));
      prev.textContent = r ? "→ " + orgTsStr({ active: true, ...r }) : tt("cantRead");
      prev.classList.toggle("is-bad", !r);
    }
    input.addEventListener("input", () => { const r = orgReadDate(input.value, cur?.dn); if (r && input.value.trim()) cal.set(merge(r)); show(); });
    input.addEventListener("keydown", (e) => {
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        cal.move({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]);
        return;
      }
      if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); cal.month(e.key === "PageUp" ? -1 : 1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        if (v === "-") return finish(null);
        const r = orgReadDate(v, cur?.dn);
        if (r) finish(merge(r));
      }
    });
    if (cur) input.value = orgDateText({ dn: cur.dn, time: cur.time, end: cur.end, rep: o.dateOnly ? null : cur.rep, warn: o.dateOnly ? null : cur.warn });
    show();
    input.focus(); input.select();
    setTimeout(() => { if (document.activeElement !== input) input.focus(); }, 0);
  });
}

/* ---------- the same commands at the editor caret */
/** The task the caret is on: its line, the planning line under it, or a continuation line of it; -1 when there is none.
 *  With `make`, a plain line or list item there becomes a task ("- [ ] …"); a heading never does. */
function orgHeadAt(lines, cl, make) {
  const here = orgLine(lines[cl]);
  if (here?.box != null) return cl;
  if (cl > 0 && OPLAN_RE.test(lines[cl]) && orgLine(lines[cl - 1])?.box != null) return cl - 1;
  if (!here) {
    const ind = oIndentW(/^[ \t]*/.exec(lines[cl] || "")[0]);
    for (let k = cl - 1; k >= 0 && lines[k].trim(); k--) { const inf = orgLine(lines[k]); if (inf) { if (inf.box != null && ind > inf.indent) return k; break; } }
  }
  if (!make || here?.type === "h" || (cl > 0 && OPLAN_RE.test(lines[cl]))) return -1;
  if (here) { lines[cl] = here.lead + here.marker + " [ ] " + here.rest; return cl; }
  const L = lines[cl] ?? "", lead = /^[ \t]*/.exec(L)[0];
  lines[cl] = lead + "- [ ] " + L.slice(lead.length);
  return cl;
}
function orgEd(ta, fn) {
  if (!ta) return;
  const v = ta.value, s = ta.selectionStart;
  const lines = v.split("\n");
  const cl = v.slice(0, s).split("\n").length - 1;
  const col = s - (v.lastIndexOf("\n", s - 1) + 1);
  const before = lines.length;
  const r = fn(lines, cl);
  if (r === false || r == null) { if (r === false) echo(tt("noEntry")); return; }
  const nv = lines.join("\n");
  if (nv !== v) {
    let a = 0;
    const mx = Math.min(v.length, nv.length);
    while (a < mx && v[a] === nv[a]) a++;
    let b = 0;
    while (b < mx - a && v[v.length - 1 - b] === nv[nv.length - 1 - b]) b++;
    edInsert(ta, a, v.length - b, nv.slice(a, nv.length - b));
  }
  const nls = nv.split("\n");
  let line = r.line ?? (cl > (r.anchor ?? Infinity) ? cl + nls.length - before : cl);
  line = Math.max(0, Math.min(line, nls.length - 1));
  const c = r.col != null ? r.col : Math.min(col + (r.dcol || 0), nls[line].length);
  let pos = 0;
  for (let k = 0; k < line; k++) pos += nls[k].length + 1;
  pos += Math.max(0, Math.min(c, nls[line].length));
  ta.setSelectionRange(pos, pos);
  if (r.msg) echo(r.msg);
  updateEdToolbar?.();
}
/** Ctrl+Enter / Ctrl+C Ctrl+T: the task's next state ([ ] → [/] → [x], Shift goes back); a plain line becomes "- [ ] …". */
function edToggleTask(ta, dir = 1) {
  orgEd(ta, (lines, cl) => {
    const had = orgHeadAt(lines, cl, false) >= 0, oldLen = lines[cl].length;
    const li = orgHeadAt(lines, cl, true);
    if (li < 0) return false;
    const msg = had ? orgSetState(lines, li, orgNextState(orgLine(lines[li]).box, dir)) : tt("stateTo", { kw: taskStateName(" ") });
    return { msg, anchor: li, dcol: li === cl ? lines[cl].length - oldLen : 0 };
  });
}
function edOrgPriority(ta, explicit) {
  orgEd(ta, (lines, cl) => {
    const li = orgHeadAt(lines, cl, false);
    if (li < 0) return false;
    const old = lines[li].length;
    const msg = orgSetPriority(lines, li, 1, explicit);
    return { msg, anchor: li, dcol: li === cl ? lines[li].length - old : 0 };
  });
}
async function edOrgAsk(ta, kind) {
  const s0 = ta.selectionStart;
  const lines0 = ta.value.split("\n");
  const cl0 = ta.value.slice(0, s0).split("\n").length - 1;
  let cur = null, li0;
  if (kind === "SCHEDULED" || kind === "DEADLINE") {
    li0 = orgHeadAt(lines0, cl0, false);
    if (li0 < 0 && orgHeadAt([...lines0], cl0, true) < 0) { echo(tt("noEntry")); return; }
    const map = li0 >= 0 && OPLAN_RE.test(lines0[li0 + 1] || "") ? orgPlanMap(lines0[li0 + 1]) : {};
    cur = orgTsParse(map[kind]);
  }
  let value;
  if (kind === "tags") {
    const info = orgLine(lines0[orgHeadAt(lines0, cl0, false)]);
    if (!info) { echo(tt("noEntry")); return; }
    const o = orgHead(info.rest);
    value = await promptModal(tt("tags"), o.tags.length ? ":" + o.tags.join(":") + ":" : "");
    if (value == null && !o.tags.length) return;
  } else if (kind === "priority") {
    value = await orgPickPriority();
    if (value === undefined) return;
  } else {
    value = await orgAskDate(kind === "SCHEDULED" ? tt("schedule") : kind === "DEADLINE" ? tt("deadline") : tt("timestamp"), cur);
    if (value === undefined || (value === null && (kind === "active" || kind === "inactive"))) { ta = $(".sn-editor-text"); ta?.focus(); ta?.setSelectionRange(s0, s0); return; }
  }
  ta = $(".sn-editor-text");
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(s0, s0);
  if (kind === "priority") return edOrgPriority(ta, value);
  if (kind === "active" || kind === "inactive") {
    const ts = orgTsStr({ active: kind === "active", dn: value.dn, time: value.time, end: value.end, rep: value.rep, warn: value.warn });
    const v = ta.value;
    const pre = s0 > 0 && !/\s/.test(v[s0 - 1]) ? " " : "";
    edInsert(ta, s0, ta.selectionEnd, pre + ts);
    return;
  }
  orgEd(ta, (lines, cl) => {
    const oldLen = lines[cl].length;
    const li = orgHeadAt(lines, cl, kind === "SCHEDULED" || kind === "DEADLINE");
    if (li < 0) return false;
    const dcol = li === cl ? lines[cl].length - oldLen : 0;
    if (kind === "tags") {
      const old = lines[li].length;
      const msg = orgSetTags(lines, li, String(value || "").split(/[:\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean));
      return { msg, anchor: li, dcol: li === cl ? lines[li].length - old : 0 };
    }
    if (value === null) { orgSetPlanning(lines, li, kind, null); return { msg: tt("planRemoved", { key: kind }), anchor: li, dcol }; }
    const ts = orgTsStr({ active: true, dn: value.dn, time: value.time, end: value.end, rep: value.rep || cur?.rep || null, warn: value.warn || cur?.warn || null });
    orgSetPlanning(lines, li, kind, ts);
    return { msg: tt("planSet", { key: kind, ts }), anchor: li, dcol };
  });
}
/** The Ctrl+C prefix in the editor (only with no selection, so Ctrl+C still copies). Returns true when handled. */
let orgPrefix = false;
export function orgEditorKey(e, ta) {
  if (orgPrefix) {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return true;
    orgPrefix = false;
    e.preventDefault(); e.stopPropagation();
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (k === "t") edToggleTask(ta);
    else if (c && k === "s") edOrgAsk(ta, "SCHEDULED");
    else if (c && k === "d") edOrgAsk(ta, "DEADLINE");
    else if (k === "," ) edOrgAsk(ta, "priority");
    else if (k === ".") edOrgAsk(ta, "active");
    else if (k === "!") edOrgAsk(ta, "inactive");
    else if (c && k === "q") edOrgAsk(ta, "tags");
    else if (c && k === "c") edToggleTask(ta);
    else if (k === "a") openTasksView();
    else if (k === "c") orgCapture();
    else if (e.key === "Escape" || (c && k === "g")) echo(defaultEcho(), { keep: true });
    else echo(tt("unknownKey", { k: (c ? "Ctrl+" + e.key.toUpperCase() : e.key) }));
    return true;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c" && ta.selectionStart === ta.selectionEnd) {
    e.preventDefault();
    orgPrefix = true;
    echo("Ctrl+C …", { keep: true });
    return true;
  }
  if (isMod(e) && e.key === "Enter") { e.preventDefault(); edToggleTask(ta, e.shiftKey ? -1 : 1); return true; }
  return false;
}
/** Toolbar buttons for the editor (called from renderEdToolbar). */
export function orgToolbar(btn, g) {
  btn(g, "list-todo", tt("cycle"), (el) => edToggleTask(el), "Ctrl+C Ctrl+T · Ctrl+Enter");
  btn(g, "flag", tt("priority"), (el) => edOrgAsk(el, "priority"), "Ctrl+C ,");
  btn(g, "calendar-clock", tt("schedule"), (el) => edOrgAsk(el, "SCHEDULED"), "Ctrl+C Ctrl+S");
  btn(g, "alarm-clock", tt("deadline"), (el) => edOrgAsk(el, "DEADLINE"), "Ctrl+C Ctrl+D");
  btn(g, "calendar-plus", tt("timestamp"), (el) => edOrgAsk(el, "active"), "Ctrl+C .");
}
export const orgLineIsEntry = (ta) => {
  const v = ta.value, s = ta.selectionStart;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", s); if (le < 0) le = v.length;
  return orgLine(v.slice(ls, le))?.box != null;
};

/** Open a note in the editor with the caret at the end of a line: beside the agenda, which stays in view. */
export function openEditorAtLine(path, lineIndex) {
  openEditor(path, { focus: true, edit: true, keepCaret: true, wide: false });
  setTimeout(() => {
    const ta = $(".sn-editor-text");
    const n = vault.notes.get(path);
    if (!n || (!ta && !(editor.mode === "edit" && editor.live))) return;
    const lines = n.raw.split("\n");
    let off = lines.slice(0, lineIndex).join("\n").length + (lineIndex ? 1 : 0);
    if (editor.mode !== "source") off -= splitNote(n.raw).fm.length;
    if (editor.mode === "edit" && editor.live) {
      const body = liveText(), le = body.indexOf("\n", Math.max(0, off));
      liveActivate(le < 0 ? body.length : le);
      return;
    }
    off = Math.max(0, Math.min(off, ta.value.length));
    const le = ta.value.indexOf("\n", off);
    ta.focus();
    ta.setSelectionRange(le < 0 ? ta.value.length : le, le < 0 ? ta.value.length : le);
    const r = caretRect(ta, off), sc = $(".sn-editor-scroll");
    if (sc) sc.scrollTop += r.top - sc.getBoundingClientRect().top - sc.clientHeight / 3;
    updateEdToolbar?.();
  }, 30);
}

/* ---------- reading view: show priorities, tags and dates like Org does */
/** A timestamp as its pill shows it: without the < > or [ ] around it, a range as "from – to". */
export const orgTsLabel = (s) => s.replace(/>--</, " – ").replace(/^[<[]|[>\]]$/g, "");
/** A timestamp as a card's face shows it: "11 Nov", "10 Nov, 10:00", a range as "9 Nov – 11 Nov"; the year only when it
 *  is not this one, the weekday and the repeater left to the note */
export function orgTsShort(s) {
  return s.split(/>--</).map((part) => {
    const m = /(\d{4})-(\d{2})-(\d{2})(?:[^\d\]>]*?(\d{1,2}:\d{2}))?/.exec(part);
    if (!m) return orgTsLabel(part);
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const day = d.toLocaleDateString(LANG, d.getFullYear() === new Date().getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
    return m[4] ? `${day}, ${m[4]}` : day;
  }).join(" – ");
}
export const ORG_DECOR_RE = /(SCHEDULED:|DEADLINE:|CLOSED:)|(<\d{4}-\d{2}-\d{2}[^>\n]*>(?:--<\d{4}-\d{2}-\d{2}[^>\n]*>)?)|(\[\d{4}-\d{2}-\d{2}[^\]\n]*\])/g;
const PLAN_KIND = { DEADLINE: "dead", SCHEDULED: "sched", CLOSED: "closed" };
/** A planning word and its timestamp as one chip, the way the agenda says it: "Tomorrow", "In 3 d.", "12 Nov"; the full
 *  Markdown in its tooltip. A deadline goes red on its day and after, amber in its warning days, unless the task is done. */
function planChip(word, stamp, li) {
  const ts = orgTsParse(stamp);
  if (!ts) return null;
  const kind = word ? PLAN_KIND[word] : ts.active ? "event" : "closed";
  const open = !li || !/\bis-state-(done|cancel)\b/.test(li.className);
  let text = kind === "closed" ? oFmt(ts.dn, "D MMM") : orgRelDay(ts.dn); // when it was done: the day, as the agenda writes a far one
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (ts.time != null && kind !== "closed") text += ", " + ohm(ts.time) + (ts.end != null ? "–" + ohm(ts.end) : "");
  const days = ts.dn - onow().dn;
  const tone = kind === "dead" && open ? (days <= 0 ? "due" : days <= orgWarnDays(ts) ? "soon" : "") : "";
  const chip = dateChip(kind, text, tone, (word ? word + ": " : "") + stamp);
  chip.classList.add("org-date");
  if (ts.rep) chip.append(ic("org-date-rep", "repeat"));
  return chip;
}
/** The reading view's task markup. `short` (a note being read): the priority as one letter and each date as a chip,
 *  as in the agenda; otherwise (previews) the words and timestamps as written, in pills. */
export function orgDecorate(el, path, { short = false } = {}) {
  for (const blk of el.querySelectorAll("li.task-list-item")) {
    blk.classList.add("org-entry");
    const host = blk.firstElementChild?.tagName === "P" ? blk.firstElementChild : blk;
    const n = host.querySelector(":scope > .task-box")?.nextSibling;
    const pm = n?.nodeType === 3 && /^(\s*)\[#([A-Z0-9])\](?=\s|$)/.exec(n.data);
    if (pm) n.replaceWith(pm[1], h("span", { cls: `pri ${pm[2]}`, text: short ? pm[2] : `[#${pm[2]}]`, title: short ? `${tt("priority")} ${pm[2]}` : null }), n.data.slice(pm[0].length));
  }
  for (const blk of el.querySelectorAll("h1, h2, h3, h4, h5, h6, li, p")) {
    for (const n of [...blk.childNodes]) {
      if (n.nodeType !== 3) continue;
      let nx = n.nextSibling;
      while (nx && nx.nodeType === 3 && !nx.data.trim()) nx = nx.nextSibling;
      if (nx && !(nx.nodeType === 1 && /^(BR|UL|OL)$/.test(nx.tagName))) continue;
      const m = /(\s):((?:[\p{L}\p{N}_@#%-]+:)+)(\s*)$/u.exec(n.data);
      if (!m) continue;
      const tags = h("span", { cls: "tags org-tags" }, m[2].split(":").filter(Boolean).map((x) => h("span", { cls: "tag", text: x })));
      n.replaceWith(n.data.slice(0, m.index) + m[1], tags);
    }
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (x) => (x.parentElement.closest("code, pre, a, .org-ts, .org-date") ?NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (walker.nextNode()) if (/SCHEDULED:|DEADLINE:|CLOSED:|[<\[]\d{4}-\d{2}-\d{2}/.test(walker.currentNode.data)) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0, m;
    const re = new RegExp(ORG_DECOR_RE.source, "g");
    const li = n.parentElement?.closest("li");
    while ((m = re.exec(n.data))) {
      frag.append(n.data.slice(last, m.index));
      if (short) {
        // a planning word takes the timestamp right after it into the same chip
        const after = m[1] ? /^\s*([<[]\d{4}-\d{2}-\d{2}[^>\]\n]*[>\]](?:--<\d{4}-\d{2}-\d{2}[^>\n]*>)?)/.exec(n.data.slice(re.lastIndex)) : null;
        const chip = m[1] ? (after ? planChip(m[1].slice(0, -1), after[1], li) : null) : planChip("", m[0], li);
        if (chip) {
          frag.append(chip);
          last = m.index + m[0].length + (after ? after[0].length : 0);
          re.lastIndex = last;
          continue;
        }
      }
      if (m[1]) frag.append(h("span", { cls: "org-plan k-" + m[1].slice(0, -1).toLowerCase(), text: m[1].slice(0, -1) }));
      else frag.append(h("span", { cls: "org-ts" + (m[3] ? " is-inactive" : ""), title: m[0], text: orgTsLabel(m[0]), "data-short": orgTsShort(m[0]) })); // cards show data-short (writing.css)
      last = m.index + m[0].length;
    }
    frag.append(n.data.slice(last));
    n.replaceWith(frag);
  }
  orgFoldSetup(el, path);
}

/* ---------- folding headings and tasks in the reading view and card previews (like Org's TAB) */
const ORG_FOLD = new Map(Object.entries(lsGet("sn-fold", {})));
const saveFold = debounce(() => { const o = {}; [...ORG_FOLD.entries()].slice(-600).forEach(([k, v]) => { if (v) o[k] = 1; }); lsSet("sn-fold", o); }, 300);
const HLEVEL = (x) => (x?.nodeType === 1 && /^H[1-6]$/.test(x.tagName) ? +x.tagName[1] : 0);
function orgFoldSetup(el, path) {
  const entries = [...el.querySelectorAll(".org-entry, h1, h2, h3, h4, h5, h6")].filter((x) => !x.closest("pre, code"));
  if (!entries.length) return;
  const seen = new Map();
  for (const blk of entries) {
    const bodies = [];
    if (HLEVEL(blk)) {
      const L = HLEVEL(blk);
      for (let x = blk.nextElementSibling; x && !(HLEVEL(x) && HLEVEL(x) <= L); x = x.nextElementSibling) bodies.push(x);
    } else {
      const lineBox = blk.firstElementChild?.tagName === "P" ? blk.firstElementChild : blk;
      const br = [...lineBox.childNodes].find((x) => x.nodeType === 1 && x.tagName === "BR");
      if (br) {
        const rest = [];
        for (let x = br; x; x = x.nextSibling) { if (lineBox === blk && x.nodeType === 1 && /^(UL|OL|P|DIV|BLOCKQUOTE|PRE|TABLE)$/.test(x.tagName)) break; rest.push(x); }
        const span = h("span", { cls: "org-body" });
        br.before(span);
        span.append(...rest);
        if (span.textContent.trim() || span.querySelector("img")) bodies.push(span); else span.replaceWith(...span.childNodes);
      }
      for (const x of blk.children) if (x !== lineBox && /^(UL|OL|P|DIV|BLOCKQUOTE|PRE|TABLE)$/.test(x.tagName)) bodies.push(x);
    }
    if (!bodies.length) continue;
    const text = (blk.firstElementChild?.tagName === "P" ? blk.firstElementChild : blk).textContent.split("\n")[0].trim().slice(0, 120);
    const n0 = (seen.get(text) || 0) + 1;
    seen.set(text, n0);
    const key = `${path}\u0000${text}\u0000${n0}`;
    blk._orgBodies = bodies;
    blk._orgKey = key;
    blk.classList.add("org-foldable");
    const btn = h("button", { type: "button", cls: "org-fold", "aria-label": ft("fold") });
    setIcon(btn, "chevron-down");
    const dots = h("button", { type: "button", cls: "org-ellipsis", text: "…" });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); orgToggleFold(blk, null, e.shiftKey ? el : null); });
    dots.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); orgToggleFold(blk, false); });
    for (const ev of ["mousedown", "dblclick"]) { btn.addEventListener(ev, (e) => e.stopPropagation()); dots.addEventListener(ev, (e) => e.stopPropagation()); }
    const host = blk.firstElementChild?.tagName === "P" ? blk.firstElementChild : blk;
    const cb = host.firstChild?.nodeType === 1 && host.firstChild.classList.contains("task-box") ? host.firstChild : null;
    (cb ? cb : host.firstChild) ? (cb || host.firstChild).before(btn) : host.append(btn);
    const lineEnd = host.querySelector(":scope > .org-body") || [...host.childNodes].find((x) => x.nodeType === 1 && /^(UL|OL)$/.test(x.tagName));
    if (lineEnd) lineEnd.before(dots); else host.append(dots);
  }
  orgApplyFold(el);
}
function orgApplyFold(el) {
  for (const blk of el.querySelectorAll(".org-foldable")) {
    const folded = !!ORG_FOLD.get(blk._orgKey);
    blk.classList.toggle("is-folded", folded);
    const btn = blk.querySelector(":scope > .org-fold, :scope > p > .org-fold");
    if (btn) { btn.setAttribute("aria-expanded", String(!folded)); btn.title = folded ? ft("unfold") : ft("fold"); btn.setAttribute("aria-label", btn.title); }
    const dots = blk.querySelector(":scope > .org-ellipsis, :scope > p > .org-ellipsis");
    if (dots) dots.title = ft("unfold");
  }
  // hide in document order so nested folds and sections inside folded headings behave like Org
  const hidden = new Set();
  for (const blk of el.querySelectorAll(".org-foldable")) {
    if (!blk.classList.contains("is-folded")) continue;
    for (const b of blk._orgBodies) hidden.add(b);
  }
  for (const blk of el.querySelectorAll(".org-foldable")) for (const b of blk._orgBodies) b.classList.toggle("org-hidden", hidden.has(b));
}
function orgToggleFold(blk, force, scope) {
  const want = force ?? !ORG_FOLD.get(blk._orgKey);
  const root = blk.closest(".markdown-rendered") || blk.parentElement;
  const targets = scope ? [...scope.querySelectorAll(".org-foldable")] : [blk];
  for (const b of targets) { if (want) ORG_FOLD.set(b._orgKey, true); else ORG_FOLD.delete(b._orgKey); }
  saveFold();
  for (const r of new Set([root, ...$$(".markdown-rendered").filter((x) => x.querySelector(".org-foldable") && !x.parentElement.closest(".markdown-rendered"))])) orgApplyFold(r);
}
/** Palette commands: fold or unfold every heading and task of the note in the editor's reading view. */
export function orgFoldNote(fold) {
  const root = $("#editor .sn-reading") || $("#editor .markdown-rendered");
  if (!root) { echo(LANG === "ru" ? "Откройте заметку в режиме чтения (Ctrl+E)" : "Open the note in reading view first (Ctrl+E)"); return; }
  const first = root.querySelector(".org-foldable");
  if (first) orgToggleFold(first, fold, root);
}

