/* =========================================================
   The agenda view (Org-agenda style): day / week agenda, task list, tag match, search, and Capture.
   ========================================================= */
import { LANG, t, tt } from "../core/i18n.js";
import { baseName, debounce, norm } from "../core/util.js";
import { oFmt, ohm, oisoWeek, onow, opad, orgCache, orgDayEntries, orgNowTs, orgPriRank, orgReadDate, orgShift, orgSkip, orgStats, orgTsStr, orgWithGrid, oymd, TASK_STATES } from "../core/org.js";
import { lsGet, lsSet } from "../services/storage.js";
import { board, vault } from "../services/state.js";
import { persistBoard } from "../services/vault.js";
import { txn, writeRaw } from "../services/save.js";
import { dailyNotePath } from "../services/daily-notes.js";
import { orgAll } from "../services/tasks.js";
import { $, $$, h, ic, iconBtn, isMod, keyText } from "./dom.js";
import { echo, Menu, openLayer, promptModal } from "./ui.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { masonries } from "./masonry.js";
import { goBack, leaveTagView, navEntry, renderBoard, setTarget } from "./board.js";
import { renderTree } from "./tree.js";
import { setSide } from "./shell.js";
import { orgCycle, orgEdit, orgPickPriority, orgPickState, orgPlanEntry, orgPri, orgRefocus, orgTagsEntry } from "./org-commands.js";
import { openEditorAtLine, orgAskDate, orgCalendar, orgDateText } from "./org-editing.js";
import { taskBox, taskIcon } from "./task-icons.js";

/* ---------- agenda state */
// log is on by default: a task closed on a day stays on that day, struck through
export const AG = Object.assign({ view: "agenda", span: "week", log: true, overOpen: true, todoKw: "ALL", match: "", search: "" }, lsGet("sn-agenda", {}), { anchor: null, filter: {}, sel: null });
/** The task list's state filter: all open tasks, or one open state. */
const TODO_FILTERS = ["ALL", ...TASK_STATES.filter((x) => x.open).map((x) => x.id)];
if (!TODO_FILTERS.includes(AG.todoKw)) AG.todoKw = "ALL";
const saveAG = () => lsSet("sn-agenda", { view: AG.view, span: AG.span, log: AG.log, overOpen: AG.overOpen, todoKw: AG.todoKw, match: AG.match });
export let AGROWS = [];
export function openTasksView(push = true, view) {
  if (view) { AG.view = view; saveAG(); }
  if (board.view === "tasks") { renderBoard(); setTimeout(() => $(".ag-body")?.focus({ preventScroll: true }), 0); return; }
  if (push) { board.history.push(navEntry()); if (board.history.length > 100) board.history.shift(); }
  if (board.tagView) leaveTagView();
  board.view = "tasks";
  board.selection.clear();
  persistBoard();
  renderBoard(true);
  renderTree();
  if (innerWidth <= 820) setSide(false);
  setTimeout(() => $(".ag-body")?.focus({ preventScroll: true }), 0);
}
export function tasksButton() {
  const b = h("button", { id: "tasks-btn", type: "button", cls: "wb-btn wb-tasks" });
  b.addEventListener("click", () => (board.view === "tasks" ? goBack() : openTasksView()));
  setTimeout(renderTasksButton, 0);
  return b;
}
export function renderTasksButton() {
  const b = $("#tasks-btn");
  if (!b) return;
  const st = orgStats(orgAll());
  b.classList.toggle("is-active", board.view === "tasks");
  b.title = keyText(tt("stats", st) + " · Ctrl+Shift+K");
  const n = st.overdue + st.today;
  b.replaceChildren(...[ic("", "calendar-check"), h("span", { cls: "wb-label", text: tt("tasks") }),
    n ? h("span", { cls: "wb-count" + (st.overdue ? " is-overdue" : " is-today"), text: String(n) }) : null].filter(Boolean));
}

/* ---------- agenda rows */
function orgTagPass(e) {
  for (const [tg, v] of Object.entries(AG.filter)) {
    const has = e.alltags.some((x) => x.toLowerCase() === tg.toLowerCase());
    if ((v === 1 && !has) || (v === -1 && has)) return false;
  }
  return true;
}
export function orgMatcher(q) {
  q = String(q || "").trim();
  let todoPart = null;
  const sl = q.indexOf("/");
  if (sl >= 0) { todoPart = q.slice(sl + 1).trim(); q = q.slice(0, sl).trim(); }
  const ors = q.split("|").map((s) => s.trim()).filter(Boolean).map((part) => {
    const terms = [], re = /([+-]?)(?:([\p{L}_][\p{L}\p{N}_-]*)\s*(<=|>=|<>|=|<|>)\s*("[^"]*"|[^\s+&|]+)|([\p{L}\p{N}_@#%{}.\/-]+))/gu;
    let m;
    const src = part.replace(/&/g, "+");
    while ((m = re.exec(src))) { if (!m[0]) break; terms.push({ neg: m[1] === "-", key: m[2], op: m[3], val: m[4] != null ? m[4].replace(/^"|"$/g, "") : null, tag: m[5]?.replace(/^#/, "") }); }
    return terms;
  });
  const todoFn = todoPart == null ? () => true : todoPart === "!" ? (e) => e.isTodo && !e.done : (e) => todoPart.replace(/^!/, "").split("|").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(e.kw);
  const cmp = (a, op, b) => {
    const num = /^-?[\d.]+$/.test(b) && /^-?[\d.]+$/.test(a);
    const x = num ? parseFloat(a) : String(a).toLowerCase(), y = num ? parseFloat(b) : String(b).toLowerCase();
    return op === "=" ? x == y : op === "<>" ? x != y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
  };
  return (e) => todoFn(e) && (!ors.length || ors.some((terms) => terms.every((tm) => {
    let r;
    if (tm.tag != null) r = e.alltags.some((x) => x.toLowerCase() === tm.tag.toLowerCase());
    else {
      const k = tm.key.toUpperCase();
      const fm = vault.notes.get(e.path)?.fm || {};
      const fk = Object.keys(fm).find((x) => x.toUpperCase() === k);
      const v = k === "STATE" || k === "TODO" ? e.kw || "" : k === "PRIORITY" ? e.pri || "B" : k === "LEVEL" ? String(e.level) : k === "CATEGORY" ? e.category : fk ? String(fm[fk]) : "";
      r = cmp(v, tm.op, tm.val);
    }
    return tm.neg ? !r : r;
  })));
}

/* ---------- the agenda view */
export function renderTasksView(root) {
  const body0 = root.querySelector(".ag-body");
  const oldScroll = body0?.scrollTop || 0;
  const hadFocus = document.activeElement === body0 || !!document.activeElement?.closest?.(".ag-row");
  const focusId = document.activeElement?.dataset?.agInput;
  root.className = "sn-board is-tasks is-agenda";
  root.replaceChildren();
  masonries.length = 0;
  const T = onow().dn;
  const all = orgAll();
  if (AG.anchor == null) AG.anchor = T;

  // top bar
  const bar = h("div", { cls: "sn-topbar" });
  const back = iconBtn("arrow-left", t("back"), () => goBack()); back.disabled = !board.history.length;
  bar.append(h("div", { cls: "sn-nav" }, back));
  const crumbs = h("div", { cls: "sn-crumbs" });
  const home = h("a", { cls: "sn-crumb", href: "#" }, ic("sn-crumb-icon", "home"), h("span", { text: t("allCards") }));
  home.addEventListener("click", (e) => { e.preventDefault(); setTarget(null); });
  crumbs.append(home, h("span", { cls: "sn-crumb-sep", text: "/" }), h("span", { cls: "sn-crumb is-current" }, ic("sn-crumb-icon", "calendar-check"), h("span", { text: tt("tasks") })));
  bar.append(crumbs);
  const tools = h("div", { cls: "sn-tools" });
  const seg = h("div", { cls: "sn-seg ag-views", role: "tablist" });
  for (const [v, k, key] of [["agenda", "vAgenda", "a"], ["todo", "vTodo", "t"], ["match", "vMatch", "m"], ["search", "vSearch", "s"]]) {
    const b = h("button", { cls: "clickable-icon" + (AG.view === v ? " is-active" : ""), type: "button", text: tt(k), title: `${tt(k)} (${key})`, role: "tab", "aria-selected": String(AG.view === v) });
    b.addEventListener("click", () => orgSetView(v));
    seg.append(b);
  }
  tools.append(seg, h("button", { cls: "wb-btn ag-capture", type: "button", title: tt("capture") + " (c)", onClick: () => orgCapture() }, ic("", "plus"), h("span", { cls: "wb-label", text: tt("capture") })));
  bar.append(tools);
  root.append(bar);

  // agenda bar
  const agbar = h("div", { cls: "agbar" });
  const btn = (text, title, fn, pressed) => { const b = h("button", { cls: "wb-btn ag-btn", type: "button", text, title, "aria-pressed": pressed == null ? null : String(!!pressed) }); b.addEventListener("click", fn); return b; };
  if (AG.view === "agenda") {
    const sp = h("div", { cls: "sn-seg" });
    for (const [v, k] of [["day", "day"], ["week", "week"]]) { const b = h("button", { cls: "clickable-icon" + (AG.span === v ? " is-active" : ""), type: "button", text: tt(k), title: `${tt(k)} (${v[0]})` }); b.addEventListener("click", () => { AG.span = v; saveAG(); renderBoard(); }); sp.append(b); }
    agbar.append(sp, btn("‹", tt("earlier"), () => orgNav(-1)), btn(tt("today"), tt("today") + " (.)", () => orgNav(0)), btn("›", tt("later"), () => orgNav(1)),
      btn(tt("goTo"), tt("goTo") + " (j)", () => orgNav("jump")), btn(tt("log"), tt("log") + " (l)", () => { AG.log = !AG.log; saveAG(); renderBoard(); }, AG.log));
  } else if (AG.view === "todo") {
    const sp = h("div", { cls: "sn-seg" });
    for (const k of TODO_FILTERS) {
      const st = TASK_STATES.find((x) => x.id === k), name = st ? tt("st_" + k) : tt("stAll");
      const b = h("button", { cls: "clickable-icon ag-state" + (AG.todoKw === k ? " is-active" : ""), type: "button", title: name, "aria-pressed": String(AG.todoKw === k) }, st ? taskIcon(st.ch) : null, h("span", { text: name }));
      b.addEventListener("click", () => { AG.todoKw = k; saveAG(); renderBoard(); });
      sp.append(b);
    }
    agbar.append(sp);
  } else {
    const isM = AG.view === "match";
    const inp = h("input", { type: "text", cls: "ag-input", spellcheck: "false", placeholder: isM ? "+work-home|PRIORITY=A/doing" : LANG === "ru" ? "слова для поиска" : "words to find", "aria-label": tt(isM ? "vMatch" : "vSearch"), dataset: { agInput: AG.view } });
    inp.value = isM ? AG.match : AG.search;
    const run = () => { if (isM) { AG.match = inp.value; saveAG(); } else AG.search = inp.value; renderBoard(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } else if (e.key === "ArrowDown") { e.preventDefault(); $(".ag-body")?.focus(); orgSelect(0, true); } else if (e.key === "Escape" && inp.value) { e.stopPropagation(); inp.value = ""; run(); } });
    if (!isM) inp.addEventListener("input", debounce(run, 200));
    agbar.append(inp, btn(tt(isM ? "vMatch" : "vSearch"), "Enter", run));
  }
  const tagCount = new Map();
  for (const e of all) if (!e.done && !orgSkip(e)) for (const x of e.alltags) tagCount.set(x.toLowerCase(), (tagCount.get(x.toLowerCase()) || 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x[0]).sort();
  for (const k of Object.keys(AG.filter)) if (!tags.includes(k)) tags.push(k);
  if (tags.length) {
    const chips = h("div", { cls: "ag-chips" });
    for (const tg of tags) {
      const v = AG.filter[tg];
      const c = h("button", { cls: "fchip" + (v === 1 ? " inc" : v === -1 ? " exc" : ""), type: "button", text: (v === 1 ? "+" : v === -1 ? "−" : "") + tg, title: "include · exclude · off (/)" });
      c.addEventListener("click", () => { if (v === 1) AG.filter[tg] = -1; else if (v === -1) delete AG.filter[tg]; else AG.filter[tg] = 1; renderBoard(); });
      chips.append(c);
    }
    agbar.append(chips);
  }
  root.append(agbar);

  // body
  const scroll = h("div", { cls: "sn-scroll ag-scroll" });
  const body = h("div", { cls: "ag-body", tabindex: "0", role: "listbox", "aria-label": tt("tasks") });
  scroll.append(body);
  root.append(scroll);
  AGROWS = [];
  const pass = (e) => orgTagPass(e);
  if (AG.view === "agenda") {
    const days = AG.span === "day" ? [AG.anchor] : Array.from({ length: 7 }, (_, i) => AG.anchor - ((oymd(AG.anchor).w + 6) % 7) + i);
    body.append(h("div", { cls: "ag-title" }, h("b", { text: tt(AG.span === "week" ? "weekAgenda" : "dayAgenda") }), ` (W${opad(oisoWeek(days[0]))})`, AG.log ? h("span", { cls: "ag-flag", text: " · " + tt("log") }) : null));
    // on a phone: the week as a strip of days (a dot where something is on), a tap opens that day; the month is one more tap
    const week0 = AG.anchor - ((oymd(AG.anchor).w + 6) % 7);
    const strip = h("div", { cls: "ag-strip", role: "toolbar", "aria-label": tt("week") });
    for (let i = 0; i < 7; i++) {
      const dn = week0 + i, has = orgDayEntries(dn, all, T, { log: AG.log }).some((x) => !x.grid && pass(x.e));
      const b = h("button", { type: "button", cls: "ag-strip-day" + (dn === T ? " is-today" : "") + (AG.span === "day" && dn === AG.anchor ? " is-on" : ""), "aria-label": oFmt(dn, "dddd D MMMM") },
        h("span", { cls: "wd", text: oFmt(dn, "ddd") }), h("span", { cls: "dn", text: String(oymd(dn).d) }), h("span", { cls: "dot" + (has ? " has" : "") }));
      b.addEventListener("click", () => { AG.span = "day"; AG.anchor = dn; saveAG(); renderBoard(); });
      strip.append(b);
    }
    strip.append(h("button", { type: "button", cls: "ag-strip-month", title: tt("month"), "aria-label": tt("month"), onClick: () => orgNav("jump") }, ic("", "calendar-days")));
    body.append(strip);
    for (const dn of days) {
      const o = oymd(dn);
      let ents = orgDayEntries(dn, all, T, { log: AG.log }).filter((x) => pass(x.e));
      // what is overdue is carried into today (as Org does) and gathered above it, in a section of its own
      const late = dn === T ? ents.filter((x) => x.overdue) : [];
      if (late.length) {
        ents = ents.filter((x) => !x.overdue);
        const head = h("button", { cls: "ag-over-head", type: "button", "aria-expanded": String(!!AG.overOpen) }, ic("ag-over-chev", "chevron-down"), h("span", { text: tt("overdue") }), h("span", { cls: "ag-over-n", text: String(late.length) }));
        head.addEventListener("click", () => { AG.overOpen = !AG.overOpen; saveAG(); renderBoard(); });
        const sec = h("section", { cls: "ag-card ag-overdue" + (AG.overOpen ? "" : " is-closed") }, h("div", { cls: "ag-day" }, head));
        if (AG.overOpen) for (const x of late) sec.append(orgRow(x));
        body.append(sec);
      }
      const sum = daySummary(ents);
      const card = h("section", { cls: "ag-card" + (dn === T ? " is-today" : "") + (ents.length ? "" : " is-empty") });
      card.append(h("div", { cls: "ag-day" + (dn === T ? " today" : "") + (o.w === 0 || o.w === 6 ? " weekend" : "") },
        h("span", { text: oFmt(dn, "dddd") }), h("span", { cls: "num", text: oFmt(dn, "D MMMM YYYY") + (o.w === 1 || AG.span === "day" ? ` · W${opad(oisoWeek(dn))}` : "") }),
        dn === T ? h("span", { cls: "today-pill", text: tt("today").toLowerCase() }) : null,
        sum ? h("span", { cls: "ag-sum", text: sum }) : null));
      if (dn === T) ents = orgWithGrid(ents);
      for (const x of ents) card.append(orgRow(x));
      body.append(card);
    }
  } else if (AG.view === "todo") {
    const items = all.filter((e) => e.isTodo && !e.done && !orgSkip(e) && (AG.todoKw === "ALL" || e.kw === AG.todoKw) && pass(e))
      .sort((a, b) => orgPriRank(b) - orgPriRank(a) || (a.category < b.category ? -1 : a.category > b.category ? 1 : a.line - b.line));
    body.append(h("div", { cls: "ag-title" }, tt("todoTitle") + " ", h("b", { text: AG.todoKw === "ALL" ? tt("stAll") : tt("st_" + AG.todoKw) }), ` · ${items.length}`));
    if (items.length) body.append(h("section", { cls: "ag-card" }, items.map((e) => orgRow({ e, kind: "todo", label: "", time: null, dn: null }))));
    if (!items.length) body.append(h("div", { cls: "ag-help", text: tt("noTodo") }));
  } else if (AG.view === "match") {
    const fn = orgMatcher(AG.match);
    const items = all.filter((e) => !orgSkip(e) && e.kind !== "event" && fn(e) && pass(e));
    body.append(h("div", { cls: "ag-title" }, tt("matchTitle") + " ", h("b", { text: AG.match || tt("everything") }), ` · ${items.length}`));
    if (items.length) body.append(h("section", { cls: "ag-card" }, items.map((e) => orgRow({ e, kind: "match", label: "", time: null, dn: null }))));
    if (!items.length) body.append(h("div", { cls: "ag-help", text: tt("noMatch") }));
    body.append(h("div", { cls: "ag-help", text: tt("matchHelp") }));
  } else {
    const words = norm(AG.search).split(/\s+/).filter(Boolean);
    body.append(h("div", { cls: "ag-title" }, tt("searchTitle") + " ", h("b", { text: AG.search || tt("typeSomething") })));
    if (words.length) {
      const items = all.filter((e) => {
        if (orgSkip(e) || !pass(e)) return false;
        const n = vault.notes.get(e.path);
        const txt = norm(n.raw.split("\n").slice(e.line, e.kind === "event" ? e.line + 1 : e.secEnd).join("\n") + " " + e.alltags.join(" "));
        return words.every((w) => (w.startsWith("-") && w.length > 1 ? !txt.includes(w.slice(1)) : txt.includes(w.replace(/^\+/, ""))));
      });
      if (items.length) body.append(h("section", { cls: "ag-card" }, items.map((e) => orgRow({ e, kind: "search", label: "", time: null, dn: null }))));
      if (!items.length) body.append(h("div", { cls: "ag-help", text: tt("nothingFound") }));
    }
  }
  body.append(h("div", { cls: "ag-help ag-keys", text: tt("keysAgenda") }));
  body.addEventListener("keydown", orgAgendaKey);
  body.addEventListener("click", (e) => {
    const row = e.target.closest(".ag-row");
    if (!row) return;
    const i = +row.dataset.i;
    const b = e.target.closest("button[data-act]");
    if (b) { e.stopPropagation(); orgAct(AGROWS[i], b.dataset.act); return; }
    if (e.target.closest("a")) return;
    orgSelect(i);
    body.focus({ preventScroll: true });
  });
  body.addEventListener("dblclick", (e) => { const row = e.target.closest(".ag-row"); if (row && !e.target.closest("button, a")) orgAct(AGROWS[+row.dataset.i], "goto"); });
  body.addEventListener("contextmenu", (e) => { const row = e.target.closest(".ag-row"); if (!row) return; orgSelect(+row.dataset.i); orgRowMenu(AGROWS[+row.dataset.i]).showAtEvent(e); });

  scroll.scrollTop = oldScroll;
  if (AG.sel) {
    let i = AGROWS.findIndex((x) => orgRowKey(x) === AG.sel);
    if (i < 0) { const ek = AG.sel.split("\u0000").slice(0, 2).join("\u0000"); i = AGROWS.findIndex((x) => x.e.key === ek); }
    if (i < 0 && AG.selRaw) i = AGROWS.findIndex((x) => x.e.path === AG.selRaw.path && x.e.raw === AG.selRaw.raw);
    if (i >= 0) orgSelect(i, false); else AG.sel = null;
  }
  if (focusId) { const inp = $(`[data-ag-input="${focusId}"]`, root); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  else if (hadFocus) body.focus({ preventScroll: true });
  renderTasksButton();
}
const orgRowKey = (x) => `${x.e.key}\u0000${x.kind}\u0000${x.dn ?? ""}`;
/** A day's line under its date: open and done tasks, and the time its timed entries take ("3 tasks · 1 done · 1h 30m"). */
function daySummary(ents) {
  const open = new Set(), done = new Set();
  let min = 0;
  for (const x of ents) {
    if (x.grid) continue;
    if (x.e.isTodo) (x.e.done ? done : open).add(x.e.key);
    if (x.time != null && x.end != null && x.end > x.time) min += x.end - x.time;
  }
  for (const k of done) open.delete(k);
  const h_ = Math.floor(min / 60), m_ = min % 60;
  return [open.size ? tt("sumTasks", { n: open.size }) : "", done.size ? tt("sumDone", { n: done.size }) : "",
    min ? (h_ && m_ ? tt("hm", { h: h_, m: m_ }) : h_ ? tt("hOnly", { h: h_ }) : tt("mOnly", { m: m_ })) : ""].filter(Boolean).join(" · ");
}
/** A date said the short way when it is close: today, tomorrow, in 3 d., 2 d. ago; else "5 Nov". */
function relDay(dn) {
  const d = dn - onow().dn;
  return d === 0 ? tt("relToday") : d === 1 ? tt("relTomorrow") : d === -1 ? tt("relYesterday") : d > 1 && d <= 7 ? tt("relIn", { n: d }) : d < -1 && d >= -7 ? tt("relAgo", { n: -d }) : oFmt(dn, "D MMM");
}
const LAB_ICON = { dead: "flag", sched: "calendar", closed: "check" };
/** The label of a row as a chip: a deadline is a flag (red when due or overdue, amber in its warning days), a scheduled date a calendar. */
function labelChip(kind, text, tone) {
  if (!text) return "";
  const k = kind.split(" ")[0];
  return h("span", { cls: "ag-chip" + (tone ? " is-" + tone : "") }, LAB_ICON[k] ? ic("", LAB_ICON[k]) : null, h("span", { text: text.replace(/:$/, "") }));
}
function orgRow(x) {
  if (x.grid) return h("div", { cls: "ag-grid" + (x.now ? " now" : "") }, h("span", { cls: "ag-cat" }), h("span", { cls: "ag-time", text: ohm(x.time) }), h("span", { cls: "dots", text: x.now ? (LANG === "ru" ? "сейчас " : "now ") : "" }));
  const i = AGROWS.push(x) - 1;
  const e = x.e;
  let label = x.label;
  let kindCls = x.kind;
  let tone = x.kind === "dead" ? (x.soon ? "soon" : x.dn != null && x.dn > onow().dn ? "" : "due") : ""; // red only on its day or after it
  if (!x.dn && x.dn !== 0 && !label) {
    if (e.dead?.active && !e.done) { label = relDay(e.dead.dn); kindCls = "dead" + (e.dead.dn < onow().dn ? " overdue" : ""); tone = e.dead.dn <= onow().dn ? "due" : ""; }
    else if (e.sched?.active && !e.done) { label = relDay(e.sched.dn); kindCls = "sched"; }
  }
  const time = x.time != null ? ohm(x.time) + (x.end != null ? "–" + ohm(x.end) : "") : "";
  const row = h("div", { cls: `ag-row k-${kindCls}` + (x.overdue ? " overdue" : "") + (e.done ? " is-done" : ""), role: "option", dataset: { i: String(i), path: e.path, line: String(e.line) } });
  const cat = h("span", { cls: "ag-cat", title: e.path, text: e.category + ":" });
  const main = h("span", { cls: "ag-main" });
  // a task's priority colours its box; only the top one also gets a letter, so it does not rest on colour alone
  if (e.isTodo) { const b = taskBox(e.state, { dataset: { act: "tick" } }); if (e.pri) { b.title +=` · ${tt("priority")} ${e.pri}`; } main.append(b); }
  if (e.pri && (!e.isTodo || e.pri === "A")) main.append(h("span", { cls: `pri ${e.pri}`, text: e.isTodo ? e.pri : `[#${e.pri}]`, title: `${tt("priority")} ${e.pri}` }));
  main.append(renderInline(e.title, e.path));
  if (e.cbTotal) main.append(h("span", { cls: "ag-cookie", text: `[${e.cbDone}/${e.cbTotal}]` }));
  const shown = e.alltags.filter((x) => !(e.title || "").toLowerCase().includes("#" + x.toLowerCase()));
  if (shown.length) main.append(h("span", { cls: "tags" }, shown.map((tg) => h("span", { cls: "tag" + (e.inherited.includes(tg) ? " inh" : ""), text: tg }))));
  const act = h("span", { cls: "ag-act" });
  if (e.kind !== "event") act.append(h("button", { type: "button", dataset: { act: "state" }, text: tt("actState"), title: "T" }));
  if (x.kind === "sched" || x.kind === "dead" || x.kind === "ts") act.append(h("button", { type: "button", dataset: { act: "later" }, text: tt("actLater"), title: "Shift+→" }));
  act.append(h("button", { type: "button", dataset: { act: "goto" }, text: tt("actOpen"), title: "Enter" }));
  row.append(h("span", { cls: "ag-meta" }, cat, h("span", { cls: "ag-time", text: time }), h("span", { cls: "ag-lab" }, labelChip(kindCls, label, tone))), main, act);
  return row;
}
function renderInline(text, path) {
  const el = h("span", { cls: "ag-ttl markdown-rendered" });
  const tmp = renderMarkdown(text || " ", path);
  const p = tmp.querySelector("p, h1, h2, h3, h4, h5, h6, li");
  el.append(...(p ? p.childNodes : tmp.childNodes));
  wireRendered(el, path);
  return el;
}
export function orgSelect(i, scroll = true) {
  const x = AGROWS[i];
  if (!x) return;
  AG.sel = orgRowKey(x);
  AG.selRaw = { path: x.e.path, raw: x.e.raw };
  $$(".ag-row.sel").forEach((r) => { r.classList.remove("sel"); r.setAttribute("aria-selected", "false"); });
  const r = $(`.ag-row[data-i="${i}"]`);
  if (r) { r.classList.add("sel"); r.setAttribute("aria-selected", "true"); if (scroll) r.scrollIntoView({ block: "nearest" }); }
}
const orgSelRow = () => AGROWS.find((x) => orgRowKey(x) === AG.sel) || null;
function orgAct(x, act) {
  if (!x) return;
  const e = x.e;
  if (act === "todo") return orgCycle(e);
  if (act === "tick") return orgCycle(e, 1, true);
  if (act === "state") return orgPickState(e);
  if (act === "later" || act === "earlier") return orgEdit(e, (L, li) => orgShift(L, li, x.kind === "dead" || x.kind === "sched" ? x.kind : "ts", act === "later" ? 1 : -1));
  if (act === "goto") return openEditorAtLine(e.path, e.line);
}
function orgRowMenu(x) {
  const e = x.e, m = new Menu();
  if (e.kind !== "event") { m.add(tt("cycle"), "list-todo", () => orgPickState(e)); m.add(tt("priority"), "flag", async () => { const p = await orgPickPriority(e.pri); if (p !== undefined) orgPri(e, 0, p); }); }
  if (e.kind !== "event") { m.add(tt("schedule"), "calendar-clock", () => orgPlanEntry(e, "SCHEDULED")); m.add(tt("deadline"), "alarm-clock", () => orgPlanEntry(e, "DEADLINE")); m.add(tt("tags"), "tag", () => orgTagsEntry(e)); }
  m.sep();
  m.add(tt("actOpen"), "file-text", () => openEditorAtLine(e.path, e.line));
  return m;
}
function orgSetView(v) {
  AG.view = v;
  AG.sel = null;
  saveAG();
  renderBoard();
  setTimeout(() => { const el = v === "match" || v === "search" ? $(`[data-ag-input="${v}"]`) : $(".ag-body"); el?.focus({ preventScroll: true }); }, 0);
}
async function orgNav(d) {
  const T = onow().dn;
  if (d === "jump") { const r = await orgAskDate(tt("jumpTo"), { dn: AG.anchor ?? T }, { dateOnly: true }); if (!r) return; AG.anchor = r.dn; }
  else if (d === 0) AG.anchor = T;
  else AG.anchor = (AG.anchor ?? T) + d * (AG.span === "week" ? 7 : 1);
  if (AG.view !== "agenda") AG.view = "agenda";
  AG.sel = null;
  renderBoard();
  setTimeout(() => { $(".ag-body")?.focus({ preventScroll: true }); if (d === 0) $(".ag-day.today")?.scrollIntoView({ block: "start" }); }, 0);
}
async function orgAskFilter() {
  const v = await promptModal(tt("filterTag"), "");
  orgRefocus();
  if (v == null) { AG.filter = {}; renderBoard(); return; }
  for (const tk of v.split(/\s+/).filter(Boolean)) { const neg = tk[0] === "-"; AG.filter[tk.replace(/^[+-]/, "").replace(/^#/, "").toLowerCase()] = neg ? -1 : 1; }
  renderBoard();
}
function orgAgendaKey(ev) {
  if (ev.altKey || ((ev.ctrlKey || ev.metaKey) && !orgAgPrefix && ev.key.toLowerCase() !== "c")) return;
  const k = ev.key;
  const cur = AGROWS.findIndex((x) => orgRowKey(x) === AG.sel);
  const row = AGROWS[cur];
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
  if (orgAgPrefix) {
    if (["Control", "Shift", "Meta"].includes(k)) return;
    orgAgPrefix = false; stop();
    const lk = k.toLowerCase();
    if (row && lk === "s") orgPlanEntry(row.e, "SCHEDULED");
    else if (row && lk === "d") orgPlanEntry(row.e, "DEADLINE");
    else if (row && lk === "t") orgPickState(row.e);
    else if (row && lk === "q") orgTagsEntry(row.e);
    else echo(tt("unknownKey", { k: "Ctrl+" + k.toUpperCase() }));
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "c") { stop(); orgAgPrefix = true; echo("Ctrl+C …", { keep: true }); return; }
  const go = (d) => { stop(); if (!AGROWS.length) return; const i = cur < 0 ? (d > 0 ? 0 : AGROWS.length - 1) : Math.max(0, Math.min(AGROWS.length - 1, cur + d)); orgSelect(i); };
  if (ev.shiftKey && (k === "ArrowRight" || k === "ArrowLeft")) { stop(); if (row) orgAct(row, k === "ArrowRight" ? "later" : "earlier"); return; }
  if (ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { stop(); if (row) orgPri(row.e, k === "ArrowUp" ? 1 : -1); return; }
  if (k === "n" || k === "ArrowDown") return go(1);
  if (k === "p" || k === "ArrowUp") return go(-1);
  if (k === "Home") return go(-1e9);
  if (k === "End") return go(1e9);
  if (k === "Enter") { if (row) { stop(); orgAct(row, "goto"); } return; }
  if (k === "t") { stop(); if (row) orgCycle(row.e); return; }
  if (k === "T") { stop(); if (row) orgPickState(row.e); return; }
  if (k === "+" || k === "=") { stop(); if (row) orgPri(row.e, 1); return; }
  if (k === "-" || k === "_") { stop(); if (row) orgPri(row.e, -1); return; }
  if (k === ",") { stop(); if (row) orgPickPriority(row.e.pri).then((p) => { orgRefocus(); if (p !== undefined) orgPri(row.e, 0, p); }); return; }
  if (k === "s") { stop(); if (row) orgPlanEntry(row.e, "SCHEDULED"); return; }
  if (k === "e") { stop(); if (row) orgPlanEntry(row.e, "DEADLINE"); return; }
  if (k === ":") { stop(); if (row) orgTagsEntry(row.e); return; }
  if (k === "d" || k === "w") { stop(); AG.span = k === "d" ? "day" : "week"; AG.view = "agenda"; saveAG(); renderBoard(); return; }
  if (k === "f" || k === "ArrowRight") { stop(); orgNav(1); return; }
  if (k === "b" || k === "ArrowLeft") { stop(); orgNav(-1); return; }
  if (k === ".") { stop(); orgNav(0); return; }
  if (k === "j") { stop(); orgNav("jump"); return; }
  if (k === "l") { stop(); AG.log = !AG.log; saveAG(); renderBoard(); echo(`${tt("log")}: ${AG.log ? "on" : "off"}`); return; }
  if (k === "r" || k === "g") { stop(); orgCache.clear(); renderBoard(); echo(LANG === "ru" ? "Агенда обновлена" : "Agenda refreshed"); return; }
  if (k === "/") { stop(); orgAskFilter(); return; }
  if (k === "\\") { stop(); AG.filter = {}; renderBoard(); return; }
  if (k === "c") { stop(); orgCapture(); return; }
  if (k === "a" || k === "A") { stop(); orgSetView("agenda"); return; }
  if (k === "m") { stop(); orgSetView("match"); return; }
  if (k === "S") { stop(); orgSetView("search"); return; }
  if (k === "q" || k === "Escape") { stop(); goBack(); return; }
  if (k === "?") { stop(); echo(tt("keysAgenda"), { hint: true }); return; }
}
let orgAgPrefix = false;

/* ---------- capture */
const CAP = Object.assign({ tpl: "t", to: "daily" }, lsGet("sn-capture", {}));
async function orgDailyPath() {
  const path = dailyNotePath();
  if (!vault.notes.has(path)) await writeRaw(path, "");
  return path;
}
export function orgCapture(pre = {}) {
  const tpls = [["t", "capTodo", "list-todo"], ["n", "capNote", "sticky-note"], ["m", "capMeeting", "users"], ["j", "capJournal", "book-open"]];
  let tpl = pre.tpl || CAP.tpl;
  const panel = h("div", { cls: "modal ag-cap", role: "dialog", "aria-label": tt("capTitle") });
  const close = openLayer(panel);
  const tplRow = h("div", { cls: "cap-tpl" });
  const head = h("input", { type: "text", cls: "cap-head", placeholder: LANG === "ru" ? "Что это?" : "What is it?", autocomplete: "off" });
  head.value = pre.head || "";
  const when = h("input", { type: "text", cls: "cap-when", placeholder: tt("dateHelp"), autocomplete: "off" });
  const hint = h("span", { cls: "cap-hint" });
  const notes = h("textarea", { cls: "cap-notes", rows: "3", placeholder: tt("capNotes") });
  const targets = [["daily", tt("capDaily")], ["inbox", `${tt("capInbox")}.md`]];
  if (board.target && vault.notes.has(board.target)) targets.push(["card:" + board.target, baseName(board.target)]);
  if (!targets.some(([v]) => v === CAP.to)) CAP.to = "daily";
  const to = h("select", { cls: "cap-to" }, targets.map(([v, l]) => h("option", { value: v, text: l, selected: v === CAP.to })));
  const calBtn = h("button", { type: "button", cls: "cap-cal-btn", title: LANG === "ru" ? "Календарь" : "Calendar", "aria-label": LANG === "ru" ? "Календарь" : "Calendar", "aria-expanded": "false" }, ic("", "calendar-days"));
  let capCal = null;
  calBtn.addEventListener("click", () => {
    if (capCal) { capCal.el.remove(); capCal = null; calBtn.setAttribute("aria-expanded", "false"); when.focus(); return; }
    capCal = orgCalendar({ value: orgReadDate(when.value || "x") || null, onChange: (r) => { when.value = orgDateText(r); upd(); } });
    calBtn.setAttribute("aria-expanded", "true");
    whenWrap.append(capCal.el);
  });
  when.addEventListener("input", () => { const r = orgReadDate(when.value); if (capCal && r && when.value.trim()) capCal.set(r); });
  when.addEventListener("keydown", (e) => {
    if (e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) { e.preventDefault(); if (!capCal) calBtn.click(); capCal.move({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]); }
  });
  const whenWrap = h("div", { cls: "cap-field" }, h("span", { text: tt("capWhen") }), h("div", { cls: "cap-when-row" }, when, calBtn), hint);
  const toWrap = h("label", { cls: "cap-field" }, h("span", { text: tt("capTo") }), to);
  const upd = () => {
    for (const b of tplRow.children) b.setAttribute("aria-pressed", String(b.dataset.tpl === tpl));
    whenWrap.hidden = tpl === "n" || tpl === "j";
    toWrap.hidden = tpl === "j";
    const v = when.value.trim();
    const r = v ? orgReadDate(v) : null;
    hint.textContent = v ? (r ? (tpl === "m" ? "" : "SCHEDULED: ") + orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep, warn: r.warn }) : tt("cantRead")) : tpl === "m" ? tt("capNeedDate") : "";
    hint.classList.toggle("is-bad", !!v && !r);
  };
  for (const [k, label, icon] of tpls) {
    const b = h("button", { type: "button", cls: "cap-tpl-btn", dataset: { tpl: k } }, ic("", icon), h("b", {}, h("span", { cls: "k", text: `[${k}]` }), " " + tt(label)));
    b.addEventListener("click", () => { tpl = k; upd(); head.focus(); });
    tplRow.append(b);
  }
  const finish = async () => {
    const title = head.value.trim();
    if (!title) { head.focus(); echo(tt("capNeedHead")); return; }
    const dv = when.value.trim();
    const r = dv && !whenWrap.hidden ? orgReadDate(dv) : null;
    if (dv && !whenWrap.hidden && !r) { when.focus(); return; }
    if (tpl === "m" && !r) { when.focus(); echo(tt("capNeedDate")); return; }
    CAP.tpl = tpl; CAP.to = to.value; lsSet("sn-capture", CAP);
    close();
    const extra = notes.value.replace(/\s+$/, "").split("\n").filter((l, i, a) => a.join("").trim()).map((l) => "  " + l);
    const ts = r ? orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep, warn: r.warn }) : null;
    let out;
    if (tpl === "t") out = [`- [ ] ${title}`, ...(ts ? [`  SCHEDULED: ${ts}`] : []), ...extra];
    else if (tpl === "n") out = [`- ${title} ${orgNowTs()}`, ...extra];
    else if (tpl === "m") out = [`- ${title} ${ts} #meeting`, ...extra];
    else out = [`- ${ohm(onow().min)} ${title}`, ...extra];
    let path;
    if (tpl === "j" || CAP.to === "daily") path = await orgDailyPath();
    else if (CAP.to === "inbox") { path = `${tt("capInbox")}.md`; if (!vault.notes.has(path)) await writeRaw(path, ""); }
    else path = CAP.to.slice(5);
    const raw = vault.notes.get(path)?.raw ?? "";
    const next = (raw && !raw.endsWith("\n") ? raw + "\n" : raw) + out.join("\n") + "\n";
    await txn(tt("capFiled", { note: baseName(path), head: title }).slice(0, 90), () => writeRaw(path, next));
  };
  panel.append(iconBtn("x", t("close"), () => close(), "modal-close"), h("div", { cls: "modal-title", text: tt("capTitle") }), tplRow,
    h("label", { cls: "cap-field" }, h("span", { text: tt("capHead") }), head), whenWrap, h("label", { cls: "cap-field" }, h("span", { text: tt("capNotes") }), notes), toWrap,
    h("div", { cls: "modal-buttons" }, h("span", { cls: "cap-keys", text: tt("capHint") }), h("button", { type: "button", text: tt("capAbort"), onClick: () => close() }), h("button", { type: "button", cls: "mod-cta", text: tt("capOk"), onClick: finish })));
  when.addEventListener("input", upd);
  panel.addEventListener("keydown", (e) => {
    if (isMod(e) && e.key === "Enter") { e.preventDefault(); finish(); return; }
    if (e.key === "Enter" && e.target === head) { e.preventDefault(); whenWrap.hidden ? finish() : when.focus(); return; }
    if (e.key === "Enter" && e.target === when) { e.preventDefault(); finish(); return; }
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "SELECT" && !e.ctrlKey && !e.metaKey) { const tp = tpls.find((x) => x[0] === e.key); if (tp) { e.preventDefault(); tpl = tp[0]; upd(); head.focus(); } }
  });
  upd();
  setTimeout(() => head.focus(), 0);
}


