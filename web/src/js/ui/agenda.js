/* =========================================================
   The agenda view (Org-agenda style): day / week agenda, task list, tag match, search, and Capture.
   ========================================================= */
import { LANG, t, tt } from "../core/i18n.js";
import { baseName, debounce, dirName, norm, hueOf } from "../core/util.js";
import { oaddMonths, oFmt, ohm, oisoWeek, onow, orgRelDay, orgDayEntries, orgPriRank, orgSkip, orgStats, orgTsStr, orgWithGrid, oymd, TASK_STATES } from "../core/org.js";
import { lsGet, lsSet } from "../services/storage.js";
import { board, vault } from "../services/state.js";
import { cardHue, cardIcon, persistBoard } from "../services/vault.js";
import { addTask, archiveClosed, orgAll, reloadTasks } from "../services/tasks.js";
import { $, $$, edgeFades, h, ic, iconBtn, isMod, keyText } from "./dom.js";
import { echo, fuzzyScore, Menu, openLayer, promptModal } from "./ui.js";
import { renderMarkdown, wireRendered } from "./markdown.js";
import { goBack, leaveTagView, navEntry, renderBoard } from "./board.js";
import { renderTree } from "./tree.js";
import { setSide, sideToggle } from "./shell.js";
import { orgCycle, orgDeleteEntry, orgLinkEntry, orgOpenEntry, orgPickPriority, orgPickState, orgPlanEntry, orgPri, orgRefocus, orgRenameEntry, orgShiftEntry, orgTagsEntry, orgWhenEntry } from "./org-commands.js";
import { orgAskDate, orgCalendar, orgDateText, orgTsShort } from "./org-editing.js";
import { vaultTags } from "./actions.js";
import { parseQuickAdd, quickAddQuery } from "../core/quick-add.js";
import { dateChip, taskBox, taskIcon } from "./task-icons.js";

/* ---------- agenda state */
// a task closed on a day always stays on that day, struck through (there is no log to turn off)
export const AG = Object.assign({ view: "agenda", span: "week", overOpen: true, todoKw: "ALL", search: "" }, lsGet("sn-agenda", {}), { anchor: null, filter: {}, sel: null });
delete AG.log; delete AG.match;
if (!["agenda", "todo", "search"].includes(AG.view)) AG.view = "agenda"; // Match is gone
/** The task list's state filter: all open tasks, or one open state. */
const TODO_FILTERS = ["ALL", ...TASK_STATES.filter((x) => x.open).map((x) => x.id)];
if (!TODO_FILTERS.includes(AG.todoKw)) AG.todoKw = "ALL";
const saveAG = () => lsSet("sn-agenda", { view: AG.view, span: AG.span, overOpen: AG.overOpen, todoKw: AG.todoKw });
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
  const b = h("button", { id: "tasks-btn", type: "button", cls: "sn-btn wb-tasks" });
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
  // overdue and today are counted apart: one sum in red said "overdue" of tasks that were only due today.
  // Overdue is a solid plate, today a tint, so the two differ by more than colour; the button's name says both in words.
  const counts = [["overdue", st.overdue, "countOverdue"], ["today", st.today, "countToday"]].filter(([, n]) => n)
    .map(([kind, n, key]) => ({ kind, n, text: tt(key, { n }) }));
  b.setAttribute("aria-label", [tt("tasks"), ...counts.map((c) => c.text)].join(", "));
  b.replaceChildren(ic("", "calendar-check"), h("span", { cls: "wb-label", text: tt("tasks") }),
    ...(counts.length ? [h("span", { cls: "wb-counts", "aria-hidden": "true" }, counts.map((c) => h("span", { cls: "wb-count is-" + c.kind, title: c.text, text: String(c.n) })))] : []));
}

/* ---------- agenda rows */
function orgTagPass(e) {
  for (const [tg, v] of Object.entries(AG.filter)) {
    const has = e.alltags.some((x) => x.toLowerCase() === tg.toLowerCase());
    if ((v === 1 && !has) || (v === -1 && has)) return false;
  }
  return true;
}

/* ---------- the agenda view */
/**
 * The month (spec TASK-4): its weeks as a grid from Monday, each day with how many entries it has (tasks scheduled or
 * due, events, and with the log on, what was closed); a click opens that day. Overdue tasks count on their own day.
 */
/** A week's days as a title: "9–15 November", "30 November – 6 December", with the year when it is not this one. */
export function dayRange(a, b, T) {
  const A = oymd(a), B = oymd(b), year = (o) => (o.y !== oymd(T).y || A.y !== B.y ? " " + o.y : "");
  if (A.y === B.y && A.m === B.m) return `${A.d}–${oFmt(b, "D MMMM")}${year(B)}`;
  return `${oFmt(a, "D MMMM")}${A.y !== B.y ? year(A) : ""} – ${oFmt(b, "D MMMM")}${year(B)}`;
}
/**
 * A view's head (restyle RS-58, RS-59): what it shows, in the accent over its title. The agenda's days and month have
 * all their navigation beside the title: the title opens "Go to…", then Day · Week · Month, then ‹ Today ›.
 */
function agHead(icon, kind, title, nav) {
  const row = h("div", { cls: "ag-title-row" }, title);
  if (nav) {
    const b = title.querySelector("b");
    if (b) {
      const jump = h("button", { cls: "ag-jump", type: "button", title: tt("goTo") + " (j)", onClick: () => orgNav("jump") });
      b.replaceWith(jump);
      jump.append(b, ic("ag-jump-chev", "chevron-down"));
    }
    const span = h("div", { cls: "sn-seg ag-span" });
    for (const [v, k, key] of [["day", "day", "d"], ["week", "week", "w"], ["month", "month", "M"]]) {
      span.append(h("button", { cls: "clickable-icon" + (AG.span === v ? " is-active" : ""), type: "button", text: tt(k), title: `${tt(k)} (${key})`, "aria-pressed": String(AG.span === v),
        onClick: () => { AG.span = v; saveAG(); renderBoard(); } }));
    }
    const steps = h("div", { cls: "ag-steps", role: "group" },
      iconBtn("chevron-left", tt("earlier"), () => orgNav(-1), "ag-nav"),
      h("button", { cls: "sn-btn ag-today", type: "button", text: tt("today"), title: tt("today") + " (.)", onClick: () => orgNav(0) }),
      iconBtn("chevron-right", tt("later"), () => orgNav(1), "ag-nav"));
    row.append(h("div", { cls: "ag-ctl" }, span, steps));
  }
  return h("div", { cls: "ag-head" + (nav ? " is-page" : "") }, h("div", { cls: "ag-kind" }, ic("", icon), h("span", { text: kind })), row);
}
function renderMonth(body, all, T, pass) {
  const first = AG.anchor - (oymd(AG.anchor).d - 1), next = oaddMonths(first, 1);
  const start = first - ((oymd(first).w + 6) % 7), weeks = Math.ceil((next - start) / 7);
  body.append(agHead("calendar-days", tt("vAgenda"), h("div", { cls: "ag-title", title: tt("monthAgenda") }, h("b", { text: oFmt(first, "MMMM YYYY") })), true));
  const grid = h("div", { cls: "ag-month", role: "grid", "aria-label": oFmt(first, "MMMM YYYY") });
  const head = h("div", { cls: "ag-month-row ag-month-head", role: "row" });
  for (let i = 0; i < 7; i++) head.append(h("span", { role: "columnheader", text: oFmt(start + i, "ddd") }));
  grid.append(head);
  for (let w = 0; w < weeks; w++) {
    const row = h("div", { cls: "ag-month-row", role: "row" });
    for (let i = 0; i < 7; i++) {
      const dn = start + w * 7 + i, o = oymd(dn);
      const n = orgDayEntries(dn, all, T, { log: true }).filter((x) => !x.overdue && pass(x.e)).length;
      const b = h("button", {
        type: "button", role: "gridcell", cls: "ag-mday" + (dn === T ? " is-today" : "") + (dn < first || dn >= next ? " is-out" : "") + (o.w === 0 || o.w === 6 ? " weekend" : "") + (n ? " has" : ""),
        "aria-label": oFmt(dn, "dddd D MMMM") + (n ? " · " + tt("sumEntries", { n }) : ""), dataset: { dn: String(dn) },
      }, h("span", { cls: "dn", text: String(o.d) }), n ? h("span", { cls: "cnt", text: String(n) }) : null);
      b.addEventListener("click", () => { AG.span = "day"; AG.anchor = dn; saveAG(); renderBoard(); });
      row.append(b);
    }
    grid.append(row);
  }
  body.append(grid);
}
export function renderTasksView(root) {
  const body0 = root.querySelector(".ag-body");
  const oldScroll = body0?.scrollTop || 0;
  const hadFocus = document.activeElement === body0 || !!document.activeElement?.closest?.(".ag-row");
  const focusId = document.activeElement?.dataset?.agInput;
  root.className = "sn-board is-tasks is-agenda";
  root.replaceChildren();
  const T = onow().dn;
  const all = orgAll();
  if (AG.anchor == null) AG.anchor = T;

  // the view's own bar
  const bar = h("div", { cls: "sn-topbar" });
  const back = iconBtn("arrow-left", t("back"), () => goBack()); back.disabled = !board.history.length;
  bar.append(h("div", { cls: "sn-nav" }, sideToggle(), back));
  // no breadcrumbs, as above the list of notes: the view's title says where it is, ← and the sidebar go back
  bar.append(h("div", { cls: "sn-crumbs" }));
  // the tags to filter by: the 30 most used by open tasks, and any already in the filter
  const tagCount = new Map();
  for (const e of all) if (!e.done && !orgSkip(e)) for (const x of e.alltags) tagCount.set(x.toLowerCase(), (tagCount.get(x.toLowerCase()) || 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x[0]).sort();
  for (const k of Object.keys(AG.filter)) if (!tags.includes(k)) tags.push(k);
  const cycle = (tg) => { const v = AG.filter[tg]; if (v === 1) AG.filter[tg] = -1; else if (v === -1) delete AG.filter[tg]; else AG.filter[tg] = 1; renderBoard(); };
  const tools = h("div", { cls: "sn-tools" });
  const seg = h("div", { cls: "sn-seg ag-views", role: "tablist" });
  for (const [v, k, key] of [["agenda", "vAgenda", "a"], ["todo", "vTodo", "t"], ["search", "vSearch", "s"]]) {
    const b = h("button", { cls: "clickable-icon" + (AG.view === v ? " is-active" : ""), type: "button", text: tt(k), title: `${tt(k)} (${key})`, role: "tab", "aria-selected": String(AG.view === v) });
    b.addEventListener("click", () => orgSetView(v));
    seg.append(b);
  }
  tools.append(seg);
  // one button for the tag filters (and, in the agenda, archiving what is closed), at every width: the chips no longer
  // take a row of their own; how many tags filter is on the button
  if (AG.view === "agenda" || tags.length) {
    const n = Object.keys(AG.filter).length;
    tools.append(h("button", { cls: "sn-btn ag-filters" + (n ? " is-active" : ""), type: "button", title: tt("filters"), "aria-label": tt("filters") + (n ? ` · ${n}` : ""), "aria-haspopup": "menu",
      onClick: (e) => {
        const m = new Menu();
        if (AG.view === "agenda") m.add(tt("archiveClosed"), "archive", archiveClosedTasks);
        if (tags.length) {
          if (AG.view === "agenda") m.sep();
          m.label(tt("filterTags"));
          for (const tg of tags) { const v = AG.filter[tg]; m.add((v === 1 ? "+" : v === -1 ? "−" : "") + tg, v === -1 ? "minus" : "tag", () => cycle(tg), { checked: v === 1 }); }
        }
        m.showBelow(e.currentTarget);
      } }, ic("", "sliders-horizontal"), h("span", { cls: "wb-label", text: tt("filters") }), n ? h("span", { cls: "ag-filter-n", text: String(n) }) : null));
  }
  tools.append(h("button", { cls: "sn-btn ag-capture", type: "button", title: tt("capture") + " (c)", onClick: () => orgCapture() }, ic("", "plus"), h("span", { cls: "wb-label", text: tt("capture") })));
  bar.append(tools);
  root.append(bar);

  // the view's own bar: the task list's states or the search line, then the tags filtering (a click includes a tag,
  // a second excludes it, a third lets it go). The agenda's days have theirs beside the title, so it often has none.
  const agbar = h("div", { cls: "agbar" });
  const btn = (text, title, fn) => { const b = h("button", { cls: "sn-btn ag-btn", type: "button", text, title }); b.addEventListener("click", fn); return b; };
  if (AG.view === "todo") {
    const sp = h("div", { cls: "sn-seg" });
    for (const k of TODO_FILTERS) {
      const st = TASK_STATES.find((x) => x.id === k), name = st ? tt("st_" + k) : tt("stAll");
      const b = h("button", { cls: "clickable-icon ag-state" + (AG.todoKw === k ? " is-active" : ""), type: "button", title: name, "aria-pressed": String(AG.todoKw === k) }, st ? taskIcon(st.ch) : null, h("span", { text: name }));
      b.addEventListener("click", () => { AG.todoKw = k; saveAG(); renderBoard(); });
      sp.append(b);
    }
    agbar.append(sp);
  } else if (AG.view === "search") {
    const inp = h("input", { type: "text", cls: "ag-input", spellcheck: "false", placeholder: LANG === "ru" ? "слова для поиска" : "words to find", "aria-label": tt("vSearch"), dataset: { agInput: "search" } });
    inp.value = AG.search;
    const run = () => { AG.search = inp.value; renderBoard(); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } else if (e.key === "ArrowDown") { e.preventDefault(); $(".ag-body")?.focus(); orgSelect(0, true); } else if (e.key === "Escape" && inp.value) { e.stopPropagation(); inp.value = ""; run(); } });
    inp.addEventListener("input", debounce(run, 200));
    agbar.append(inp, btn(tt("vSearch"), "Enter", run));
  }
  const on = Object.keys(AG.filter);
  if (on.length) {
    const chips = h("div", { cls: "ag-chips", role: "group", "aria-label": tt("filterTags") }, h("span", { cls: "ag-chips-label", "aria-hidden": "true" }, ic("", "tag"), tt("filterByTag")));
    for (const tg of on) {
      const v = AG.filter[tg];
      chips.append(h("button", { cls: "sn-chip" + (v === 1 ? " is-accent" : " is-danger is-struck"), type: "button", text: (v === 1 ? "+" : "−") + tg, title: "include · exclude · off", onClick: () => cycle(tg) }));
    }
    agbar.append(chips);
  }
  if (agbar.childElementCount) root.append(agbar);
  for (const s of agbar.querySelectorAll(":scope > .sn-seg")) edgeFades(s);

  // body
  const scroll = h("div", { cls: "sn-scroll ag-scroll" });
  const body = h("div", { cls: "ag-body", tabindex: "0", role: "listbox", "aria-label": tt("tasks") });
  scroll.append(body);
  root.append(scroll);
  AGROWS = [];
  const pass = (e) => orgTagPass(e);
  if (AG.view === "agenda" && AG.span === "month") renderMonth(body, all, T, pass);
  else if (AG.view === "agenda") {
    const days = AG.span === "day" ? [AG.anchor] : Array.from({ length: 7 }, (_, i) => AG.anchor - ((oymd(AG.anchor).w + 6) % 7) + i);
    // the title says which days ("9–15 November", or the day), the week's number beside it; the log is the bar's toggle
    // the tab above already says Agenda: the line over the title names the week only (#29)
    body.append(agHead("calendar-check", tt("weekN", { n: oisoWeek(days[0]) }),
      h("div", { cls: "ag-title", title: tt(AG.span === "week" ? "weekAgenda" : "dayAgenda") },
        h("b", { text: AG.span === "week" ? dayRange(days[0], days[6], T) : oFmt(days[0], "dddd, D MMMM") + (oymd(days[0]).y !== oymd(T).y ? " " + oymd(days[0]).y : "") })), true));
    // on a phone: the week as a strip of days (a dot where something is on), a tap opens that day; the month is one more tap
    const week0 = AG.anchor - ((oymd(AG.anchor).w + 6) % 7);
    const strip = h("div", { cls: "ag-strip", role: "toolbar", "aria-label": tt("week") });
    for (let i = 0; i < 7; i++) {
      // the dot says something is on; the name says how much, for a screen reader
      const dn = week0 + i, n = orgDayEntries(dn, all, T, { log: true, carried: true }).filter((x) => !x.grid && pass(x.e)).length, has = n > 0;
      const b = h("button", { type: "button", cls: "ag-strip-day" + (dn === T ? " is-today" : "") + (AG.span === "day" && dn === AG.anchor ? " is-selected" : ""), "aria-label": oFmt(dn, "dddd D MMMM") + (n ? " · " + tt("sumEntries", { n }) : "") },
        h("span", { cls: "wd", text: oFmt(dn, "ddd") }), h("span", { cls: "dn", text: String(oymd(dn).d) }), h("span", { cls: "dot" + (has ? " has" : "") }));
      b.addEventListener("click", () => { AG.span = "day"; AG.anchor = dn; saveAG(); renderBoard(); });
      strip.append(b);
    }
    strip.append(h("button", { type: "button", cls: "ag-strip-month", title: tt("month"), "aria-label": tt("month"), onClick: () => { AG.span = "month"; saveAG(); renderBoard(); } }, ic("", "calendar-days")));
    body.append(strip);
    // what is overdue is carried into today (as Org does) and gathered in a section of its own, above the days
    // (in a week, above Monday rather than between two days)
    const late = days.includes(T) ? orgDayEntries(T, all, T, { log: true }).filter((x) => pass(x.e) && x.overdue) : [];
    if (late.length) {
      const head = h("button", { cls: "ag-over-head", type: "button", "aria-expanded": String(!!AG.overOpen) }, ic("ag-over-chev", "chevron-down"), h("span", { text: tt("overdue") }), h("span", { cls: "ag-over-n", text: String(late.length) }));
      head.addEventListener("click", () => { AG.overOpen = !AG.overOpen; saveAG(); renderBoard(); });
      const sec = h("section", { cls: "ag-card ag-overdue" + (AG.overOpen ? "" : " is-closed") }, h("div", { cls: "ag-day" }, head));
      if (AG.overOpen) for (const x of late) sec.append(orgRow(x));
      body.append(sec);
    }
    for (const dn of days) {
      const o = oymd(dn);
      let ents = orgDayEntries(dn, all, T, { log: true, carried: days.includes(T) }).filter((x) => pass(x.e));
      if (dn === T) ents = ents.filter((x) => !x.overdue);
      const sum = daySummary(ents);
      // a day's head over a card of its rows (restyle RS-62 to RS-64): every day its date, today a plate after it
      const card = h("section", { cls: "ag-card is-day" + (dn === T ? " is-today" : "") + (ents.length ? "" : " is-empty") });
      card.append(h("div", { cls: "ag-day" + (dn === T ? " today" : "") + (o.w === 0 || o.w === 6 ? " weekend" : "") },
        h("span", { text: oFmt(dn, "dddd") }),
        h("span", { cls: "num", text: oFmt(dn, "D MMMM YYYY") }),
        dn === T ? h("span", { cls: "today-pill", text: tt("today") }) : null,
        sum ? h("span", { cls: "ag-sum", text: sum }) : null));
      if (dn === T) ents = orgWithGrid(ents);
      if (ents.length) { const rows = h("div", { cls: "ag-rows" }); for (const x of ents) rows.append(orgRow(x)); card.append(rows); }
      body.append(card);
    }
  } else if (AG.view === "todo") {
    const items = all.filter((e) => e.isTodo && !e.done && !orgSkip(e) && (AG.todoKw === "ALL" || e.kw === AG.todoKw) && pass(e))
      .sort((a, b) => orgPriRank(b) - orgPriRank(a) || (a.category < b.category ? -1 : a.category > b.category ? 1 : a.line - b.line));
    body.append(agHead("list-todo", tt("vTodo"), h("div", { cls: "ag-title" }, tt("todoTitle") + " ", h("b", { text: AG.todoKw === "ALL" ? tt("stAll") : tt("st_" + AG.todoKw) }), ` · ${items.length}`)));
    if (items.length) body.append(h("section", { cls: "ag-card" }, items.map((e) => orgRow({ e, kind: "todo", label: "", time: null, dn: null }))));
    if (!items.length) body.append(h("div", { cls: "ag-help", text: tt("noTodo") }));
  } else {
    const words = norm(AG.search).split(/\s+/).filter(Boolean);
    body.append(agHead("search", tt("vSearch"), h("div", { cls: "ag-title" }, tt("searchTitle") + " ", h("b", { text: AG.search || tt("typeSomething") }))));
    if (words.length) {
      const items = all.filter((e) => {
        if (orgSkip(e) || !pass(e)) return false;
        const txt = norm(e.fullTitle + " " + e.alltags.join(" ") + " " + e.category);
        return words.every((w) => (w.startsWith("-") && w.length > 1 ? !txt.includes(w.slice(1)) : txt.includes(w.replace(/^\+/, ""))));
      });
      if (items.length) body.append(h("section", { cls: "ag-card" }, items.map((e) => orgRow({ e, kind: "search", label: "", time: null, dn: null }))));
      if (!items.length) body.append(h("div", { cls: "ag-help", text: tt("nothingFound") }));
    }
  }
  // the category ("Week:", from the note) only tells something when the rows come from more than one
  body.classList.toggle("one-cat", new Set(AGROWS.map((x) => x.e.category)).size <= 1);
  // a list where nothing has a time (the task list, a search) has no column for it
  body.classList.toggle("no-time", !AGROWS.some((x) => x.time != null));
  body.addEventListener("keydown", orgAgendaKey);
  body.addEventListener("click", (e) => {
    const row = e.target.closest(".ag-row");
    if (!row) return;
    const i = +row.dataset.i;
    const b = e.target.closest("button[data-act]");
    if (b) { e.stopPropagation(); orgAct(AGROWS[i], b.dataset.act); return; }
    if (e.target.closest("a.ag-cat")) { e.preventDefault(); orgAct(AGROWS[i], "goto"); return; }
    if (e.target.closest("a")) return;
    orgSelect(i);
    body.focus({ preventScroll: true });
  });
  body.addEventListener("dblclick", (e) => { const row = e.target.closest(".ag-row"); if (row && !e.target.closest("button, a")) orgAct(AGROWS[+row.dataset.i], "goto"); });
  body.addEventListener("contextmenu", (e) => { const row = e.target.closest(".ag-row"); if (!row) return; orgSelect(+row.dataset.i); orgRowMenu(AGROWS[+row.dataset.i]).showAtEvent(e); });

  scroll.scrollTop = oldScroll;
  if (AG.sel) {
    let i = AGROWS.findIndex((x) => orgRowKey(x) === AG.sel);
    if (i < 0) { const ek = AG.sel.split("\u0000")[0]; i = AGROWS.findIndex((x) => x.e.key === ek); }
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
const relDay = orgRelDay;
/** The label of a row as a chip (task-icons.js dateChip, which a note being read uses too). */
const labelChip = (kind, text, tone) => (text ? dateChip(kind.split(" ")[0], text.replace(/:$/, ""), tone) : "");
function orgRow(x) {
  // the line for now: its time on a plate at the line's start, not in the column of the times things start at
  if (x.now) return h("div", { cls: "ag-grid now", title: tt("now") }, h("span", { cls: "ag-time" }),
    h("span", { cls: "dots" }, h("span", { cls: "ag-now-pill" }, h("span", { cls: "ag-now-word", text: tt("now") + " " }), ohm(x.time))));
  if (x.grid) return h("div", { cls: "ag-grid" }, h("span", { cls: "ag-time", text: ohm(x.time) }), h("span", { cls: "dots" }));
  const i = AGROWS.push(x) - 1;
  const e = x.e;
  let label = x.label;
  let kindCls = x.kind;
  let tone = x.kind === "dead" ? (x.soon ? "soon" : x.dn != null && x.dn > onow().dn ? "" : "due") : ""; // red only on its day or after it
  if (!x.dn && x.dn !== 0 && !label) {
    if (e.dead?.active && !e.done) { label = relDay(e.dead.dn); kindCls = "dead" + (e.dead.dn < onow().dn ? " overdue" : ""); tone = e.dead.dn <= onow().dn ? "due" : ""; }
    else if (e.sched?.active && !e.done) { label = relDay(e.sched.dn); kindCls = "sched"; }
  }
  // a row under its own day needs no "Scheduled" chip: the day already says so (late and deadline chips stay)
  if (x.kind === "sched" && !x.overdue && label === tt("lScheduled")) label = "";
  const time = x.time != null ? ohm(x.time) + (x.end != null ? "–" + ohm(x.end) : "") : "";
  // a late task whose deadline is still ahead says when, beside its late date: the same task under that day is no surprise
  const T = onow().dn, ahead = x.overdue && x.kind === "sched" && !e.done && e.dead?.active && e.dead.dn >= T ? e.dead.dn : null;
  const dueChip = () => (ahead == null ? null : dateChip("dead", tt("deadline") + " " + relDay(ahead), ahead === T ? "due" : ahead === T + 1 ? "soon" : ""));
  const row = h("div", { cls: `ag-row k-${kindCls}` + (x.overdue ? " overdue" : "") + (e.done ? " is-done" : "") + (x.time != null ? " has-time" : ""), role: "option", dataset: { i: String(i), id: e.id, path: e.path || "" } });
  const main = h("span", { cls: "ag-main" });
  // a task's priority colours its box; only the top one also gets a letter, so it does not rest on colour alone
  if (e.isTodo) { const b = taskBox(e.state, { dataset: { act: "tick" } }); if (e.pri) { b.title +=` · ${tt("priority")} ${e.pri}`; } main.append(b); }
  else if (e.kind === "event") main.append(h("span", { cls: "ag-ev-bar hue-" + hueOf(e.category), "aria-hidden": "true" }));
  if (e.pri && (!e.isTodo || e.pri === "A")) main.append(h("span", { cls: `pri ${e.pri}`, text: e.isTodo ? e.pri : `[#${e.pri}]`, title: `${tt("priority")} ${e.pri}` }));
  // #tags at the end of the title move to the line under it, with the other tags; a #tag mid-sentence stays in place
  const known = new Set(e.alltags.map((x) => x.toLowerCase()));
  let title = e.title || "";
  for (let m; (m = /\s+#([\p{L}\p{N}_\-/]+)\s*$/u.exec(title)) && known.has(m[1].toLowerCase());) title = title.slice(0, m.index);
  const inTitle = title.toLowerCase();
  main.append(renderInline(title, e.path));
  if (e.cbTotal) main.append(h("span", { cls: "ag-cookie", text: `[${e.cbDone}/${e.cbTotal}]` }));
  // its tags and the note it is in, quietly under its title (spec UI-18); the note is left out when every row comes from one note (.one-cat)
  const shown = e.alltags.filter((x) => !inTitle.includes("#" + x.toLowerCase()));
  const sub = h("span", { cls: "ag-sub" });
  // a phone shows an untimed row's date chip on this line, before its tags (the desktop keeps it in its own column);
  // only one of the two copies is ever displayed, so a screen reader reads it once
  if (!time && label) sub.append(h("span", { cls: "ag-lab ag-lab-sub" }, labelChip(kindCls, label, tone), dueChip()));
  if (shown.length) sub.append(h("span", { cls: "tags" }, shown.map((tg) => h("span", { cls: "sn-chip is-s hue-" + hueOf(tg) + (e.inherited.includes(tg) ? " is-outline" : ""), title: e.inherited.includes(tg) ? tt("tagInherited") : null, text: tg }))));
  // the note it belongs to, a click opens it; a task without one, or whose note is gone, says so quietly
  sub.append(e.path ? h("a", { cls: "ag-cat", href: "#", title: e.path, text: e.category, tabindex: "-1" })
    : h("span", { cls: "ag-cat is-none", title: e.category, text: e.category }));
  main.append(sub);
  const act = h("span", { cls: "ag-act" });
  if (e.kind !== "event") act.append(h("button", { type: "button", dataset: { act: "state" }, text: tt("actState"), title: "T" }));
  if (x.kind === "sched" || x.kind === "dead" || x.kind === "ts") act.append(h("button", { type: "button", dataset: { act: "later" }, text: tt("actLater"), title: "Shift+→" }));
  if (e.path) act.append(h("button", { type: "button", dataset: { act: "goto" }, text: tt("actOpen"), title: "Enter" }));
  row.append(h("span", { cls: "ag-meta" }, h("span", { cls: "ag-time", text: time }), h("span", { cls: "ag-lab" + (ahead == null ? "" : " has-two") }, labelChip(kindCls, label, tone), dueChip())), main, act);
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
  AG.selRaw = { id: x.e.id };
  $$(".ag-row.is-selected").forEach((r) => { r.classList.remove("is-selected"); r.setAttribute("aria-selected", "false"); });
  const r = $(`.ag-row[data-i="${i}"]`);
  if (r) { r.classList.add("is-selected"); r.setAttribute("aria-selected", "true"); if (scroll) r.scrollIntoView({ block: "nearest" }); }
}
function orgAct(x, act) {
  if (!x) return;
  const e = x.e;
  if (act === "todo") return orgCycle(e);
  if (act === "tick") return orgCycle(e, 1, true);
  if (act === "state") return orgPickState(e);
  if (act === "later" || act === "earlier") return orgShiftEntry(e, x.kind === "dead" || x.kind === "sched" ? x.kind : "ts", act === "later" ? 1 : -1);
  if (act === "goto") return orgOpenEntry(e);
}
function orgRowMenu(x) {
  const e = x.e, m = new Menu();
  if (e.kind !== "event") { m.add(tt("cycle"), "list-todo", () => orgPickState(e)); m.add(tt("priority"), "flag", async () => { const p = await orgPickPriority(e.pri); if (p !== undefined) orgPri(e, 0, p); }); }
  if (e.kind !== "event") { m.add(tt("schedule"), "calendar-clock", () => orgPlanEntry(e, "SCHEDULED")); m.add(tt("deadline"), "alarm-clock", () => orgPlanEntry(e, "DEADLINE")); }
  else m.add(tt("timestamp"), "calendar-clock", () => orgWhenEntry(e));
  m.add(tt("tags"), "tag", () => orgTagsEntry(e));
  m.add(tt("taskRename"), "pencil", () => orgRenameEntry(e));
  m.sep();
  if (e.path) m.add(tt("taskOpenNote", { note: e.category }), "file-text", () => orgOpenEntry(e));
  m.add(e.noteId ? tt("taskLinkOther") : tt("taskLink"), "link", () => orgLinkEntry(e));
  m.sep();
  m.add(tt("taskDelete"), "trash-2", () => orgDeleteEntry(e), { warning: true });
  return m;
}
function orgSetView(v) {
  AG.view = v;
  AG.sel = null;
  saveAG();
  renderBoard();
  setTimeout(() => { const el = v === "search" ? $(`[data-ag-input="${v}"]`) : $(".ag-body"); el?.focus({ preventScroll: true }); }, 0);
}
async function orgNav(d) {
  const T = onow().dn;
  if (d === "jump") { const r = await orgAskDate(tt("jumpTo"), { dn: AG.anchor ?? T }, { dateOnly: true }); if (!r) return; AG.anchor = r.dn; }
  else if (d === 0) AG.anchor = T;
  else if (AG.span === "month") AG.anchor = oaddMonths(AG.anchor ?? T, d);
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
  if (k === "s") { stop(); if (row) (row.e.kind === "event" ? orgWhenEntry(row.e) : orgPlanEntry(row.e, "SCHEDULED")); return; }
  if (k === "e") { stop(); if (row) orgPlanEntry(row.e, "DEADLINE"); return; }
  if (k === ":") { stop(); if (row) orgTagsEntry(row.e); return; }
  if (k === "d" || k === "w" || k === "M") { stop(); AG.span = k === "d" ? "day" : k === "w" ? "week" : "month"; AG.view = "agenda"; saveAG(); renderBoard(); return; }
  if (k === "f" || k === "ArrowRight") { stop(); orgNav(1); return; }
  if (k === "b" || k === "ArrowLeft") { stop(); orgNav(-1); return; }
  if (k === ".") { stop(); orgNav(0); return; }
  if (k === "j") { stop(); orgNav("jump"); return; }
  if (k === "r" || k === "g") { stop(); reloadTasks().then(() => { renderBoard(); echo(LANG === "ru" ? "Повестка обновлена" : "Agenda refreshed"); }); return; }
  if (k === "F2") { stop(); if (row) orgRenameEntry(row.e); return; }
  if (k === "Delete") { stop(); if (row) orgDeleteEntry(row.e); return; }
  if (k === "L") { stop(); if (row) orgLinkEntry(row.e); return; }
  if (k === "/") { stop(); orgAskFilter(); return; }
  if (k === "\\") { stop(); AG.filter = {}; renderBoard(); return; }
  if (k === "c") { stop(); orgCapture(); return; }
  if (k === "a" || k === "A") { stop(); orgSetView("agenda"); return; }
  if (k === "S") { stop(); orgSetView("search"); return; }
  if (k === "q" || k === "Escape") { stop(); goBack(); return; }
  if (k === "?") { stop(); echo(tt("keysAgenda"), { hint: true }); return; }
}
let orgAgPrefix = false;

/* ---------- capture */
// one line, as Todoist's quick add: the date is read from the words ("fri 14:00", "завтра в 10:00"), #tag tags the task,
// @Note links it to a note (a list of notes comes up after the @ and narrows as the name is typed). The chips under the
// line show what was read; the + adds what the line can't say (a priority, a deadline). The task goes to tasks.jsonl.
/** The notes whose names match `q`, best first; with no `q`, the last changed. */
function capNoteMatches(q, limit = 8) {
  const all = [...vault.notes.keys()];
  if (!q.trim()) return all.sort((a, b) => (vault.notes.get(b)?.mtime || 0) - (vault.notes.get(a)?.mtime || 0)).slice(0, limit);
  return all.map((p) => ({ p, s: fuzzyScore(q, baseName(p)) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || baseName(a.p).localeCompare(baseName(b.p), undefined, { numeric: true })).slice(0, limit).map((x) => x.p);
}
/** The tags that match `q` (the vault's, most used first; those that start with it before those that contain it). */
function capTagMatches(q, limit = 8) {
  const n = norm(q);
  return vaultTags().map((x) => x.name).filter((name) => !n || norm(name).includes(n))
    .sort((a, b) => Number(norm(b).startsWith(n)) - Number(norm(a).startsWith(n))).slice(0, limit);
}
/** An editable one-line block (`el`) with an input's `value`, `selectionStart` and `setSelectionRange`, counted in its text. */
function capLine(el) {
  const offsetIn = (node, off) => { const r = document.createRange(); r.setStart(el, 0); r.setEnd(node, off); return r.toString().length; };
  Object.defineProperties(el, {
    value: {
      get: () => el.textContent.replace(/\n/g, " "),
      set: (v) => { el.textContent = v; if (document.activeElement === el) el.setSelectionRange(v.length); },
    },
    selectionStart: {
      get: () => {
        const s = getSelection();
        return s && s.rangeCount && el.contains(s.focusNode) ? offsetIn(s.focusNode, s.focusOffset) : null;
      },
    },
  });
  el.setSelectionRange = (at) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, left = at, last = null;
    const r = document.createRange();
    while ((node = walk.nextNode())) {
      last = node;
      if (left <= node.length) { r.setStart(node, left); break; }
      left -= node.length;
    }
    if (!node) { if (last) r.setStart(last, last.length); else r.setStart(el, 0); }
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges(); s.addRange(r);
  };
  return el;
}
/** " hue-blue" for a tag's or a note's hue, "" for none (a notebook). */
const capHue = (hue) => (hue ? " hue-" + hue : "");
const capTs = (r) => (r ? orgTsStr({ active: true, dn: r.dn, time: r.time, end: r.end, rep: r.rep, warn: r.warn }) : null);
/** Capture (c, the sidebar's Capture, Ctrl+Alt+N from anywhere): a task in one line.
 *  `pre`: { head, link } — `link` a note's path to link the task to. */
export function orgCapture(pre = {}) {
  const notes = [...vault.notes.keys()].map((p) => ({ name: baseName(p), path: p }));
  const keepDate = []; // phrases the date chip's × said are words
  let pri = null, dead = null, cal = null, parsed = null;
  const panel = h("div", { cls: "modal ag-cap is-quick", role: "dialog", "aria-label": tt("capTitle") });
  const close = openLayer(panel, () => window.removeEventListener("keydown", onEsc, true));
  // the line is an editable block, not an <input>, so the words read as a date, a tag or a note can be marked in it, plates
  // with room around their letters (in a field a plate could only lie under the text, flush with it); capLine gives it
  // an input's value, selectionStart and setSelectionRange, so the rest reads as it would for a field
  const input = capLine(h("div", { cls: "cap-input", contenteditable: "plaintext-only", spellcheck: "false", "data-placeholder": tt("capPlaceholder"),
    role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list", "aria-label": tt("capTitle") }));
  const linked = pre.link && vault.notes.has(pre.link) ? baseName(pre.link) : "";
  input.value = [pre.head || "", linked ? "@" + linked : ""].filter(Boolean).join(" ") + (pre.head || linked ? " " : "");
  const field = h("div", { cls: "cap-line" }, input);
  const list = h("div", { cls: "cap-list", role: "listbox", hidden: true });
  const chips = h("div", { cls: "cap-chips" });
  const calBox = h("div", { cls: "cap-cal", hidden: true });

  /* suggestions after @ and # */
  let shown = [], sel = 0, query = null;
  const listOpen = () => !list.hidden;
  const hideList = () => { list.hidden = true; query = null; input.setAttribute("aria-expanded", "false"); };
  const mark = () => [...list.children].forEach((r, i) => { r.classList.toggle("is-selected", i === sel); if (i === sel) r.scrollIntoView({ block: "nearest" }); });
  const suggest = () => {
    const q = quickAddQuery(input.value, input.selectionStart ?? input.value.length);
    // a note already named in full, with more typed after it, is done with
    if (!q || (q.kind === "note" && parsed?.note?.path && parsed.note.start === q.start && parsed.note.end < q.start + 1 + q.query.length)) { hideList(); return; }
    query = q;
    shown = q.kind === "note" ? capNoteMatches(q.query).map((p) => ({ p, name: baseName(p) })) : capTagMatches(q.query).map((name) => ({ p: null, name }));
    if (!shown.length || (shown.length === 1 && norm(shown[0].name) === norm(q.query))) { hideList(); return; }
    sel = 0;
    const dirsDiffer = shown.some((x) => x.p && dirName(x.p) !== dirName(shown[0].p));
    list.replaceChildren(...shown.map((x, i) => {
      const row = h("div", { cls: "suggestion-item", role: "option" },
        ic("suggestion-icon", x.p ? cardIcon(x.p) || "file-text" : "hash"), h("span", { cls: "suggestion-title", text: x.name }),
        dirsDiffer && x.p && dirName(x.p) ? h("span", { cls: "suggestion-note", text: dirName(x.p) }) : null);
      row.addEventListener("mousemove", () => { if (sel !== i) { sel = i; mark(); } });
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(x); }); // before the field's blur
      return row;
    }));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    mark();
  };
  const pick = (x) => {
    if (!query) return;
    const caret = input.selectionStart ?? input.value.length;
    const ins = (query.kind === "note" ? "@" : "#") + x.name + " ";
    const rest = input.value.slice(caret).replace(/^ /, "");
    input.value = input.value.slice(0, query.start) + ins + rest;
    const at = query.start + ins.length;
    input.setSelectionRange(at, at);
    hideList(); render(); input.focus();
  };

  /* the text: what it says, marked, and the chips */
  const cut = (a, b) => {
    const v = input.value;
    input.value = (v.slice(0, a).replace(/ $/, "") + " " + v.slice(b).replace(/^ /, "")).replace(/^ /, "");
    render(); input.focus();
  };
  const insert = (s) => {
    const v = input.value;
    input.value = v + (v && !/\s$/.test(v) ? " " : "") + s;
    input.setSelectionRange(input.value.length, input.value.length);
    input.focus(); render(); suggest();
  };
  const chip = (icon, text, { onClick = null, onRemove = null, cls = "", title = "" } = {}) => {
    const b = h("button", { type: "button", cls: "cap-chip " + cls, title: title || text }, ic("", icon), h("span", { cls: "cap-chip-text", text }));
    if (onClick) b.addEventListener("click", onClick);
    if (!onRemove) return b;
    const x = iconBtn("x", tt("capRemove"), (e) => { e.stopPropagation(); onRemove(); }, "cap-chip-x");
    return h("span", { cls: "cap-chip-wrap " + cls }, b, x);
  };
  const setDate = (kind, r) => {
    if (!r) return;
    if (kind === "dead") { dead = r; renderChips(); return; }
    const d = parsed?.date, txt = orgDateText(r);
    if (d) input.value = input.value.slice(0, d.start) + txt + input.value.slice(d.end);
    else input.value = input.value + (input.value && !/\s$/.test(input.value) ? " " : "") + txt;
    render();
  };
  const toggleCal = (kind) => {
    if (cal && cal.kind === kind) { calBox.hidden = true; cal = null; input.focus(); renderChips(); return; }
    const cur = kind === "dead" ? dead : parsed?.date?.r;
    const c = orgCalendar({
      value: cur || { dn: onow().dn }, dateOnly: kind === "dead",
      onChange: (r) => setDate(kind, r),
      onAccept: (r) => { setDate(kind, r); toggleCal(kind); },
    });
    cal = { kind, c };
    calBox.replaceChildren(c.el);
    calBox.hidden = false;
    renderChips();
  };
  const priMenu = (el) => {
    const m = new Menu();
    for (const p of ["A", "B", "C"]) m.add(tt("priority") + " " + p, "flag", () => { pri = p; renderChips(); input.focus(); }, { checked: pri === p });
    if (pri) { m.sep(); m.add(tt("priRemoved"), "x", () => { pri = null; renderChips(); input.focus(); }); }
    m.showBelow(el);
  };
  const moreMenu = (el) => {
    const m = new Menu();
    m.add(tt("capNoteItem") + "  @", "file-text", () => insert("@"));
    m.add(tt("capTagItem") + "  #", "hash", () => insert("#"));
    m.add(tt("capDate"), "calendar-days", () => toggleCal("sched"));
    m.sep();
    m.add(tt("priority"), "flag", () => priMenu(el));
    m.add(tt("deadline"), "alarm-clock", () => toggleCal("dead"));
    m.showBelow(el);
  };
  const renderChips = () => {
    const p = parsed;
    const out = [h("button", { type: "button", cls: "cap-chip cap-more", title: tt("capMore"), "aria-label": tt("capMore"), onClick: (e) => moreMenu(e.currentTarget) }, ic("", "plus"))];
    if (p.note) out.push(chip(p.note.path ? cardIcon(p.note.path) || "file-text" : "file-question", p.note.path ? p.note.name : "@" + p.note.name,
      { cls: p.note.path ? "is-set is-note" : "is-bad", title: p.note.path ? p.note.name : tt("capNoMatchNote"), onRemove: () => cut(p.note.start, p.note.end) }));
    else out.push(chip("inbox", tt("capNoNote"), { cls: "is-note-pick", onClick: () => insert("@") }));
    if (p.date) out.push(chip("calendar-days", orgTsShort(capTs(p.date.r)) + (p.date.r.rep ? " ↻" : ""),
      { cls: "is-set is-date" + (cal?.kind === "sched" ? " is-open" : ""), title: p.date.text, onClick: () => toggleCal("sched"), onRemove: () => { keepDate.push(p.date.text.toLowerCase()); render(); input.focus(); } }));
    else out.push(chip("calendar-days", tt("capDate"), { cls: "is-date-pick" + (cal?.kind === "sched" ? " is-open" : ""), onClick: () => toggleCal("sched") }));
    for (const tg of p.tags) out.push(chip("hash", tg.name, { cls: "is-set is-tag", onRemove: () => cut(tg.start, tg.end) }));
    if (pri) out.push(chip("flag", tt("priority") + " " + pri, { cls: "is-set is-pri", onClick: (e) => priMenu(e.currentTarget), onRemove: () => { pri = null; renderChips(); } }));
    if (dead) out.push(chip("alarm-clock", tt("deadline") + " " + orgTsShort(capTs(dead)), { cls: "is-set is-dead" + (cal?.kind === "dead" ? " is-open" : ""), onClick: () => toggleCal("dead"), onRemove: () => { dead = null; if (cal?.kind === "dead") toggleCal("dead"); renderChips(); } }));
    chips.replaceChildren(...out);
  };
  const render = () => {
    const v = input.value;
    parsed = parseQuickAdd(v, { notes, keepDate });
    const spans = [
      ...(parsed.date ? [[parsed.date.start, parsed.date.end, "is-date"]] : []),
      ...parsed.tags.map((x) => [x.start, x.end, "is-tag" + capHue(hueOf(x.name))]),
      ...(parsed.note ? [[parsed.note.start, parsed.note.end, parsed.note.path ? "is-note" + capHue(cardHue(parsed.note.path)) : "is-bad"]] : []),
    ].sort((a, b) => a[0] - b[0]);
    const parts = [];
    let at = 0;
    for (const [a, b, cls] of spans) { if (a < at) continue; parts.push(v.slice(at, a), h("span", { cls: "cap-mark " + cls, text: v.slice(a, b) })); at = b; }
    parts.push(v.slice(at));
    // the marks are drawn anew from the text; the caret keeps its place in it
    const caret = input.selectionStart;
    input.replaceChildren(...parts.filter((x) => x !== ""));
    if (caret != null) input.setSelectionRange(caret, caret);
    renderChips();
  };

  const finish = async () => {
    const p = parseQuickAdd(input.value, { notes, keepDate });
    if (!p.title) { input.focus(); echo(tt("capNeedHead")); return; }
    if (p.note && !p.note.path) { input.focus(); input.setSelectionRange(p.note.end, p.note.end); suggest(); echo(tt("capNoMatchNote")); return; }
    const notePath = p.note?.path && vault.notes.has(p.note.path) ? p.note.path : null;
    const tags = [...new Set(p.tags.map((x) => x.name))];
    close();
    await addTask({ state: " ", title: p.title, pri, tags, sched: capTs(p.date?.r), dead: capTs(dead) },
      { notePath, label: (notePath ? tt("capFiled", { note: baseName(notePath), head: p.title }) : tt("taskAdded", { title: p.title })).slice(0, 90) });
  };
  // Esc closes the list, then the calendar, then the form (the form's own Esc listens on the document, after this)
  const onEsc = (e) => {
    if (e.key !== "Escape") return;
    if (listOpen()) { e.preventDefault(); e.stopPropagation(); hideList(); }
    else if (cal) { e.preventDefault(); e.stopPropagation(); toggleCal(cal.kind); }
  };
  window.addEventListener("keydown", onEsc, true);
  // while a word is being composed (an IME, a dead key) the text is left alone; it is read when the word is done
  input.addEventListener("input", (e) => { if (e.isComposing) return; render(); suggest(); });
  input.addEventListener("compositionend", () => { render(); suggest(); });
  input.addEventListener("click", suggest);
  input.addEventListener("keyup", (e) => { if (/^(Arrow(Left|Right)|Home|End)$/.test(e.key)) suggest(); });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) hideList(); }, 0));
  input.addEventListener("keydown", (e) => {
    if (listOpen()) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); return; }
      if ((e.key === "Enter" && !isMod(e)) || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(shown[sel]); return; }
    }
    if (e.key === "Enter") { e.preventDefault(); finish(); }
  });
  const send = h("button", { type: "button", cls: "is-primary cap-send", title: tt("capOk") + " (Enter)", "aria-label": tt("capOk"), onClick: finish }, ic("", "arrow-up"));
  const cancel = iconBtn("x", tt("capAbort"), () => close(), "cap-cancel");
  panel.append(h("div", { cls: "cap-box" }, field, list), h("div", { cls: "cap-bar" }, chips, h("div", { cls: "cap-acts" }, cancel, send)), calBox);
  render();
  const toEnd = () => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); };
  toEnd(); setTimeout(() => { if (document.activeElement !== input) toEnd(); }, 0);
}
/** Move the tasks closed before today to the archive (the agenda's filter menu, the command list). */
export async function archiveClosedTasks() { await archiveClosed(1); }
