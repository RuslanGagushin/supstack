/* =========================================================
   App shell
   ========================================================= */
import { ft, fvt, LANG, setLang, st, t, tt, ut, wt } from "../core/i18n.js";
import { on } from "../services/events.js";
import { board, editor, graph, S, saveUI, setGraph, tree, UI, vault } from "../services/state.js";
import { buildGraph, persistBoard, readVault, saveSettings } from "../services/vault.js";
import { undo } from "../services/save.js";
import { runSync, stopSync, sync, syncAvailable, syncBoot } from "../services/sync.js";
import { upd } from "../services/updates.js";
import { lsGet, lsSet } from "../services/storage.js";
import { $, h, ic, iconBtn, keyName, keyText } from "./dom.js";
import { defaultEcho, echo, Menu, notice, openLayer, promptModal, suggestModal } from "./ui.js";
import { createCard, promptAddTag, quickOpen, saveCurrentView, tagTargets, togglePin } from "./actions.js";
import { goBack, patchBoard, renderBoard, setTarget, toggleSearch } from "./board.js";
import { renderTree, renderTreeSoft, revealInTree } from "./tree.js";
import { closeEditor, openEditor, renderEditor, syncEditorFromDisk } from "./editor.js";
import { renderEditorProps } from "./editor-toolbar.js";
import { pickVault, showWelcome } from "./welcome.js";
import { syncButton, syncSettingsBody, syncSettingsModal } from "./sync-panel.js";
import { openToday, outlineMenu, setFocusMode } from "./completion.js";
import { orgFoldNote } from "./org-editing.js";
import { AG, openTasksView, orgCapture, renderTasksButton, tasksButton } from "./agenda.js";
import { onow } from "../core/org.js";
import { filesButton, openFilesView } from "./files.js";
import { aboutBody } from "./about.js";

export function applyTheme() {
  const dark = UI.theme === "dark" || (UI.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("theme-dark", dark);
  document.body.classList.toggle("theme-light", !dark);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
export function applyLanguage() {
  const pref = UI.lang !== "auto" ? UI.lang : S.language && S.language !== "auto" ? S.language : (navigator.language || "en").slice(0, 2);
  setLang(pref);
  document.documentElement.lang = LANG;
}
export function setSide(open) {
  UI.sideOpen = open;
  saveUI();
  $("#app").classList.toggle("side-closed", !open);
}
function showLoading(on) {
  $(".sn-loading")?.remove();
  if (on) document.body.append(h("div", { cls: "sn-loading" }, ic("sn-spin", "loader-2"), h("span", { text: t("indexing") })));
}
let refreshQueued = false;
export function refresh(o = {}) {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    setGraph(buildGraph());
    patchBoard();
    renderTreeSoft();
    renderTasksButton();
    if (editor.path) {
      if (!vault.notes.has(editor.path)) renderEditor();
      else if (!o.keepEditor && !editor.dirty) syncEditorFromDisk();
      else renderEditorProps();
    }
  });
}
function commandList() {
  const c = [];
  // on: a setting this command switches, or the board's current sort; the palette ticks it
  const add = (title, icon, run, key, on) => c.push({ title, icon, keys: key ? key.split("+") : null, run, checked: !!on });
  add(t("openShort") + "…", "search", quickOpen, "Ctrl+O");
  add(wt("todayHint"), "calendar-days", openToday, "Ctrl+Shift+D");
  add(tt("tasksHint"), "calendar-check", () => openTasksView(true, "agenda"), "Ctrl+Shift+K");
  add(`${tt("tasks")}: ${tt("vTodo")}`, "list-todo", () => openTasksView(true, "todo"));
  add(`${tt("tasks")}: ${tt("vMatch")}`, "tags", () => openTasksView(true, "match"));
  add(`${tt("tasks")}: ${tt("vSearch")}`, "search", () => openTasksView(true, "search"));
  add(tt("capTitle") + "…", "plus-circle", () => orgCapture());
  add(fvt("files"), "paperclip", () => openFilesView(), "Ctrl+Shift+E");
  if (editor.path) { add(ft("foldAll"), "chevrons-down-up", () => orgFoldNote(true)); add(ft("unfoldAll"), "chevrons-up-down", () => orgFoldNote(false)); }
  add(wt("focus"), "focus", () => setFocusMode(!UI.focus), "Ctrl+Shift+F", UI.focus);
  if (editor.path) add(wt("outline"), "table-of-contents", () => outlineMenu($("#editor .sn-editor-head") || document.body));
  add(t("newCard"), "plus", async () => { const title = await promptModal(t("newCard")); if (title) createCard(title, board.target, "", undefined, { open: true }); });
  if (board.target) add(t("cmdEditTarget"), "pencil", () => openEditor(board.target, { focus: true }));
  if (board.target) add(t("toParent"), "arrow-up", () => { const ps = graph.parentsOf(board.target).filter((p) => graph.has(p)); setTarget(ps[0] ?? null); }, "Alt+↑");
  add(t("back"), "arrow-left", goBack, "Alt+←");
  add(t("allCards"), "home", () => setTarget(null));
  add(t("searchAndFilters").replace(/ \(.*\)$/, ""), "search", () => toggleSearch(true), "Ctrl+F");
  for (const [v, k] of [["manual", "sortManual"], ["name", "sortName"], ["modified", "sortModified"], ["created", "sortCreated"]]) add(t("cmdSort", { s: t(k) }), "arrow-up-down", () => { board.sort = v; persistBoard(); renderBoard(); }, null, board.sort === v);
  add(t("selectMode"), "check-square", () => { board.selectMode = !board.selectMode; if (!board.selectMode) board.selection.clear(); renderBoard(); }, null, board.selectMode);
  const tagPaths = tagTargets();
  if (tagPaths.length) add(t("menuAddTag"), "tag", () => promptAddTag(tagPaths), "Ctrl+Shift+T");
  add(t("saveView"), "bookmark-plus", saveCurrentView);
  if (board.target) add(t("pin"), "pin", () => togglePin(board.target), null, S.pinned.includes(board.target));
  add(t("revealCurrent"), "crosshair", () => revealInTree(board.target));
  add(t("collapseAll"), "chevrons-down-up", () => { tree.expanded.clear(); persistBoard(); renderTree(); });
  add(t("cmdSidebar"), "panel-left", () => setSide($("#app").classList.contains("side-closed")), "Ctrl+\\", !$("#app").classList.contains("side-closed"));
  add(t("cmdDark"), "moon", () => { const dark = document.body.classList.contains("theme-dark"); UI.theme = dark ? "light" : "dark"; saveUI(); applyTheme(); }, null, document.body.classList.contains("theme-dark"));
  add(t("undo"), "undo-2", undo, "Ctrl+Z");
  if (vault.fs.kind === "disk") add(t("reload"), "refresh-cw", async () => { await loadVault(vault.fs); notice(t("vaultReloaded")); });
  add(t("openOther"), "folder-open", pickVault);
  add(t("settings"), "settings", settingsModal);
  add(t("hotkeys"), "keyboard", hotkeysModal, "?");
  if (syncAvailable()) {
    add("Git: " + st("cmdNow"), "git-branch", () => runSync());
    add("Git: " + st("cmdSettings"), "settings-2", syncSettingsModal);
  }
  return c;
}
/** The palette lists the last few commands run first (by title, kept per device). */
const RECENT_KEY = "sn-cmd-recent", RECENT_MAX = 5;
export async function commandPalette() {
  const all = commandList();
  const recent = lsGet(RECENT_KEY, []).map((title) => all.find((c) => c.title === title)).filter(Boolean);
  const items = [...recent.map((c) => ({ ...c, group: t("cmdRecent") })), ...all.filter((c) => !recent.includes(c)).map((c) => ({ ...c, group: recent.length ? t("commands") : null }))];
  const pick = await suggestModal({ placeholder: t("cmdPalette"), items });
  if (!pick) return;
  lsSet(RECENT_KEY, [pick.title, ...lsGet(RECENT_KEY, []).filter((x) => x !== pick.title)].slice(0, RECENT_MAX));
  pick.run();
}
export function wbBtn(iconName, label, onClick, cls = "", kbd = null) {
  const b = h("button", { cls: "wb-btn " + cls, type: "button", title: label }, iconName ? ic("", iconName) : null, h("span", { cls: "wb-label", text: label }), kbd ? h("kbd", { text: kbd }) : null);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
/** The button that opens the sidebar from a view's own bar; it shows only while the sidebar is closed (board.css) */
export function sideToggle() { return iconBtn("panel-left", t("toggleSidebar"), () => setSide(true), "sn-side-toggle"); }
function renderAll() {
  applyLanguage();
  const app = $("#app");
  app.replaceChildren();
  app.classList.toggle("side-closed", !UI.sideOpen || innerWidth <= 820);
  app.classList.toggle("focus-mode", !!UI.focus);
  document.documentElement.style.setProperty("--side-w", UI.sideW + "px");
  document.documentElement.style.setProperty("--editor-w", UI.editorW + "px");
  document.documentElement.style.setProperty("--list-w", (UI.listW || 380) + "px");
  const vaultMenu = (e) => {
    const m = new Menu();
    if (vault.fs.kind === "disk") m.add(t("reload"), "refresh-cw", async () => { await loadVault(vault.fs); notice(t("vaultReloaded")); });
    m.add(t("openOther"), "folder-open", () => pickVault());
    m.add(t("closeVault"), "log-out", async () => { closeEditor(); await stopSync(); vault.fs = null; showWelcome(); });
    m.showBelow(e.currentTarget);
  };
  const newCard = async () => { const title = await promptModal(t("newCard")); if (title) createCard(title, board.target, "", undefined, { open: true }); };
  // there is no top bar: search, the new-card button, the agenda, Files, sync, settings and the vault live in the sidebar,
  // and each view's own bar opens the sidebar when it is closed (sideToggle)
  const search = h("button", { cls: "sb-search", type: "button", title: t("openShort") + " · Ctrl+O" }, ic("", "search"), h("span", { text: t("searchShort") }));
  search.addEventListener("click", () => quickOpen());
  const sideHead = h("div", { cls: "sb-head" }, search,
    h("div", { cls: "sb-actions" },
      wbBtn("plus", t("newShort"), newCard, "sb-new"),
      iconBtn("calendar-days", wt("today"), () => openToday(), "sb-round"),
      iconBtn("terminal", t("commands") + " · Ctrl+P", () => commandPalette(), "sb-round")));
  // a demo or a copy says so under its name for as long as it is open (the toast shows it only once)
  const standing = defaultEcho();
  const note = vault.fs.kind === "demo" ? t("demoShort") : vault.fs.kind === "copy" ? t("copyShort") : "";
  const account = h("button", { cls: "sb-account" + (note ? " has-note" : ""), type: "button", title: standing ? vault.fs.name + " — " + standing : vault.fs.name },
    h("span", { cls: "sb-avatar", text: (vault.fs.name || "S").trim().charAt(0).toUpperCase() }),
    h("span", { cls: "sb-account-name" }, h("span", { text: vault.fs.name }), note ? h("small", { cls: "sb-account-note", text: note }) : null), ic("wb-caret", "chevron-down"));
  account.addEventListener("click", vaultMenu);
  const sideNav = h("nav", { cls: "sb-nav", "aria-label": t("tabbar") }, tasksButton(), filesButton(), syncButton());
  const foot = h("div", { cls: "sb-foot" }, account,
    iconBtn("settings", t("settings"), () => settingsModal(), "sb-foot-btn"),
    iconBtn("panel-left-close", t("toggleSidebar"), () => setSide(false), "sb-foot-btn sb-collapse"));
  const side = h("div", { cls: "sn-side" }, sideHead, sideNav, h("div", { cls: "sn-outline", id: "tree" }), foot);
  const sideRes = h("div", { cls: "sn-resizer is-side" });
  makeResizer(sideRes, (dx, start) => { UI.sideW = Math.max(180, Math.min(520, start + dx)); document.documentElement.style.setProperty("--side-w", UI.sideW + "px"); }, () => UI.sideW);
  const main = h("div", { cls: "sn-main win" }, h("div", { cls: "sn-board-host" }, h("div", { id: "board", cls: "sn-board", tabindex: "0" })));
  const edRes = h("div", { cls: "sn-resizer is-editor" });
  // the same handle sizes the note beside the board, or, in the list of notes, the list beside the note
  const sideNow = () => (document.getElementById("app").classList.contains("side-closed") ? 0 : UI.sideW);
  const listing = () => document.getElementById("app").classList.contains("notes-layout");
  makeResizer(edRes, (dx, start) => {
    if (listing()) { UI.listW = Math.max(260, Math.min(innerWidth - 420 - sideNow(), 640, start + dx)); document.documentElement.style.setProperty("--list-w", UI.listW + "px"); return; }
    UI.editorW = Math.max(340, Math.min(innerWidth - 440 - sideNow(), start - dx)); document.documentElement.style.setProperty("--editor-w", UI.editorW + "px");
  }, () => (listing() ? UI.listW || 380 : UI.editorW));
  const ed = h("div", { cls: "sn-editor win", id: "editor" });
  const scrim = h("div", { cls: "sn-side-scrim", onClick: () => setSide(false) });
  const frame = h("div", { cls: "wb-frame" }, side, scrim, sideRes, main, edRes, ed);
  app.append(frame, tabBar());
  echo(defaultEcho(), { keep: true });
  renderTree();
  renderBoard(true);
}
/** The phone's bottom bar (shown only on touch screens, see app.css): the board, the agenda (a second tap goes to today),
   finding a card by name, and capture. It slides away while a list scrolls down and comes back when it scrolls up. */
function tabBar() {
  const tab = (id, icon, label, run) => h("button", { cls: "sn-tab", type: "button", dataset: { tab: id }, "aria-label": label, onClick: run }, ic("", icon), h("span", { text: label }));
  const bar = h("nav", { cls: "sn-tabbar", "aria-label": t("tabbar") },
    tab("board", "layout-grid", t("tabBoard"), () => { closeEditor(); setTarget(null); }),
    tab("agenda", "calendar-check", t("tabAgenda"), () => {
      if (board.view !== "tasks") { closeEditor(); openTasksView(); return; }
      AG.view = "agenda"; AG.anchor = onow().dn; renderBoard();
      setTimeout(() => $(".ag-day.today")?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
    }),
    tab("search", "search", t("tabSearch"), () => quickOpen()),
    tab("capture", "plus", t("tabCapture"), () => orgCapture()));
  const last = new WeakMap();
  document.addEventListener("scroll", (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!(el instanceof Element)) return;
    const y = el.scrollTop, prev = last.get(el) ?? y;
    last.set(el, y);
    if (Math.abs(y - prev) < 6) return;
    bar.classList.toggle("is-hidden", y > prev && y > 40);
  }, true);
  return bar;
}
function makeResizer(el, onMove, getStart) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const x0 = e.clientX, start = getStart();
    el.classList.add("is-dragging");
    el.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev.clientX - x0, start);
    const up = () => { el.classList.remove("is-dragging"); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); saveUI(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}
/** Settings, one tab per group. `tab` picks the tab (the last one used otherwise); with the dialog open it just switches to it. */
let settingsOpen = null;
/** Settings: sections in a list on the left (with a search over all of them), their options on the right, in groups
   of rows on cards. Opening it again while it is open switches the section. */
export function settingsModal(tab) {
  if (settingsOpen) { settingsOpen(tab); return; }
  const panel = h("div", { cls: "modal mod-settings" });
  const leaveTab = () => { sync.panel = null; upd.view = null; };
  const close = openLayer(panel, () => { leaveTab(); settingsOpen = null; renderAll(); if (editor.path) openEditor(editor.path, { keepCaret: true }); });
  const item = (name, desc, control) => h("div", { cls: "setting-item" }, h("div", { cls: "setting-item-info" }, h("div", { cls: "setting-item-name", text: name }), desc ? h("div", { cls: "setting-item-description", text: desc }) : null), h("div", { cls: "setting-item-control" }, control));
  const heading = (text) => h("h3", { cls: "sn-set-heading", text });
  const select = (value, options, onChange) => { const s = h("select", {}, options.map(([v, l]) => h("option", { value: v, text: l, selected: String(v) === String(value) }))); s.addEventListener("change", () => onChange(s.value)); return s; };
  const text = (value, ph, onChange, type = "text") => { const i = h("input", { type, value: String(value ?? ""), placeholder: ph || "" }); i.addEventListener("change", () => onChange(i.value)); return i; };
  const toggle = (value, onChange) => {
    const c = h("div", { cls: "checkbox-container" + (value ? " is-enabled" : ""), role: "switch", tabindex: "0", "aria-checked": String(!!value) });
    const flip = () => { const on = c.classList.toggle("is-enabled"); c.setAttribute("aria-checked", String(on)); onChange(on); };
    c.addEventListener("click", flip);
    c.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } });
    return c;
  };
  const save = () => { saveSettings(); setGraph(buildGraph()); };
  // where the board's options are kept; nothing to say before a vault is open (Appearance opens without one)
  const storedIn = () => (vault.fs ? h("p", { cls: "sn-set-note", text: vault.fs.kind === "disk" ? t("settingsShared") : t("settingsLocal") }) : null);
  const sections = [
    // one section for how things look: the interface (language, theme), then the board's defaults
    ["appearance", t("sectionAppearance"), "palette", "options", () => [
      heading(t("setGroupUi")),
      item(t("setLanguage"), null, select(UI.lang, [["auto", "Auto"], ["en", "English"], ["ru", "Русский"]], (v) => { UI.lang = v; saveUI(); applyLanguage(); close(); settingsModal("appearance"); })),
      item(t("setTheme"), null, select(UI.theme, [["auto", t("themeAuto")], ["light", t("themeLight")], ["dark", t("themeDark")]], (v) => { UI.theme = v; saveUI(); applyTheme(); })),
      heading(t("setGroupView")),
      item(t("setDefaultSort"), null, select(S.defaultSort, [["manual", t("sortManual")], ["name", t("sortName")], ["modified", t("sortModified")], ["created", t("sortCreated")]], (v) => { S.defaultSort = v; save(); })),
      item(t("setMaxCards"), null, text(S.maxCards, "1000", (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) { S.maxCards = Math.floor(n); save(); } }, "number")),
      storedIn(),
    ]],
    ["keys", t("hotkeys"), "keyboard", "options", () => hotkeyRows().map(([k, d]) => item(keyText(d), null, k))],
    syncAvailable() && ["sync", "Git", "git-branch", "app", () => syncSettingsBody(item, toggle, heading)],
    ["about", ut("about"), "info", "app", () => aboutBody(item, toggle)],
  ].filter(Boolean);
  // consecutive rows become one card; headings, notes and buttons sit between the cards
  const cards = (nodes) => {
    const out = [];
    let card = null;
    for (const n of nodes.flat().filter(Boolean)) {
      if (n.classList?.contains("setting-item")) { if (!card) out.push((card = h("div", { cls: "sn-set-group" }))); card.append(n); }
      else { card = null; out.push(n); }
    }
    return out;
  };
  const search = h("input", { cls: "sn-set-search", type: "search", placeholder: t("setSearch"), "aria-label": t("setSearch"), spellcheck: "false", autocomplete: "off" });
  const nav = h("div", { cls: "sn-set-tabs", role: "tablist", "aria-orientation": "vertical" });
  const body = h("div", { cls: "sn-set-body", role: "tabpanel" });
  const buttons = new Map();
  const mark = (id) => { for (const [k, b] of buttons) { b.classList.toggle("is-active", k === id); b.setAttribute("aria-selected", String(k === id)); b.tabIndex = k === id ? 0 : -1; } };
  const show = (id) => {
    if (id === "board") id = "appearance"; // the board options moved into Appearance: old links and a remembered tab land there
    const sec = sections.find((x) => x[0] === id) || sections[0];
    leaveTab();
    if (search.value) search.value = "";
    body.replaceChildren(...cards(sec[4]()));
    body.scrollTop = 0;
    mark(sec[0]);
    buttons.get(sec[0]).scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (UI.settingsTab !== sec[0]) { UI.settingsTab = sec[0]; saveUI(); }
  };
  // the search looks through every section's rows by name and description
  const find = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { show(UI.settingsTab); return; }
    leaveTab();
    const out = [];
    for (const [, label, , , make] of sections) {
      const hits = make().flat().filter((n) => n?.classList?.contains("setting-item") && n.textContent.toLowerCase().includes(q));
      if (hits.length) out.push(heading(label), ...hits);
    }
    body.replaceChildren(...(out.length ? cards(out) : [h("p", { cls: "sn-set-note", text: t("setNoMatch") })]));
    body.scrollTop = 0;
    mark(null);
  };
  search.addEventListener("input", find);
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; find(); } });
  let group = null;
  for (const [id, label, icon, grp] of sections) {
    if (grp !== group) { group = grp; nav.append(h("div", { cls: "sn-set-nav-group", text: t(grp === "app" ? "setGroupApp" : "setGroupOptions") })); }
    const b = h("button", { cls: "sn-set-tab", type: "button", role: "tab", onClick: () => show(id) }, ic("sn-set-tab-icon", icon), h("span", { text: label }));
    buttons.set(id, b);
    nav.append(b);
  }
  // arrow keys move between sections
  nav.addEventListener("keydown", (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = sections.findIndex((x) => x[0] === UI.settingsTab), n = sections.length;
    const next = sections[(i + d + n) % n][0];
    show(next);
    buttons.get(next).focus();
  });
  const side = h("div", { cls: "sn-set-side" }, h("div", { cls: "sn-set-search-row" }, ic("sn-set-search-icon", "search"), search), nav);
  panel.append(iconBtn("x", t("close"), () => close(), "modal-close"), h("div", { cls: "modal-title", text: t("settings") }), h("div", { cls: "sn-set-layout" }, side, body));
  settingsOpen = (id) => show(id || UI.settingsTab);
  show(tab || UI.settingsTab);
}
/** Every keyboard shortcut: [keys, what it does]. */
function hotkeyRows() {
  const kb = (...keys) => h("span", { cls: "suggestion-keys" }, keys.map((k) => h("kbd", { text: keyName(k) })));
  return [[kb("Ctrl", "P"), t("k_palette")], [kb("Alt", "X"), t("k_palette")], [kb("click"), t("k_click")], [kb("dbl-click"), t("k_dbl")],
    [kb("←", "↑", "→", "↓"), t("k_arrows")], [kb("Enter"), t("k_enter")], [kb("Alt", "↑"), t("k_parent")], [kb("Alt", "←"), t("k_back")], [kb("Shift", "Enter"), t("k_shiftEnter")], [kb("Ctrl", "Enter"), t("k_modEnter")],
    [kb("Space"), t("k_space")], [kb("Shift", "click"), t("k_shiftClick")], [kb("Delete"), t("k_delete")], [kb("a…z"), t("k_type")], [kb("Ctrl", "F"), t("k_find")],
    [kb("Ctrl", "A"), t("k_selectAll")], [kb("Ctrl", "Z"), t("k_undo")], [kb("Ctrl", "O"), t("k_open")], [kb("Esc"), t("k_esc")], [kb("Ctrl", "Alt"), t("k_drag")],
    [kb("[["), t("k_link")], [kb("Ctrl", "L"), t("k_link")], [kb("Ctrl", "E"), t("k_reading")],
    [kb("/"), wt("slashHint")], [kb("#"), wt("tagsSection")], [kb("Ctrl", "Shift", "T"), t("menuAddTag").replace("…", "")], [kb("Ctrl", "Shift", "D"), wt("todayHint")], [kb("Ctrl", "Shift", "F"), wt("focus")],
    [kb("Ctrl", "Shift", "K"), tt("tasksHint")], [kb("Ctrl", "Shift", "E"), fvt("filesHint")], [kb("Ctrl", "Enter"), LANG === "ru" ? "Задача: следующее состояние (в редакторе)" : "Next task state (in the editor)"],
    [kb("Ctrl", "C", "…"), tt("keysEditor")], [kb(LANG === "ru" ? "агенда" : "agenda"), tt("keysAgenda")]];
}
/** The keyboard shortcuts are a section of the settings. */
export function hotkeysModal() { settingsModal("keys"); }

/** Open a vault: read it (services/vault.js readVault), then show it and start syncing. */
export async function loadVault(fs) {
  showLoading(true);
  try {
    await readVault(fs);
    applyLanguage();
    closeEditor(true);
    $("#welcome")?.remove();
    renderAll();
    $("#board")?.focus();
    syncBoot();
  } finally { showLoading(false); }
}
on("changed", () => refresh());
