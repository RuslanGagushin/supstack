/* =========================================================
   The note's panel (inspector): everything about the open note beside its text — its properties, tasks, outline,
   the notes that link to it and its facts. On a desktop it is a column at the right of the note, shown or hidden
   by a button in the note's header (kept per device). When the note's pane is too narrow for a column it lies over
   the text, and on a phone it is a sheet from the bottom; both only while asked for.
   ========================================================= */
import { t, wt } from "../core/i18n.js";
import { editor, saveUI, UI, vault } from "../services/state.js";
import { cardTaskProgress } from "../services/tasks.js";
import { $, h, ic, iconBtn } from "./dom.js";
import { formatDate } from "./cards.js";
import { fillProps, mentionsBox } from "./editor-toolbar.js";
import { noteOutline } from "./completion.js";

/** The note's pane holds the panel as a column from this width on (app.css says the same in its container query). */
export const INSP_DOCK = 760;
const PHONE = "(max-width: 820px)";
let peek = false; // asked for where there is no room for a column: over the text, or a sheet on a phone

const pane = () => $("#editor");
const isPhone = () => matchMedia(PHONE).matches;
/** Is there room for the panel as a column beside the note? */
export const inspectorFits = () => !isPhone() && (pane()?.getBoundingClientRect().width ?? 0) >= INSP_DOCK;
/** Is the panel showing now, as a column, over the text or as a sheet? */
export const inspectorShown = () => peek || (inspectorFits() && UI.inspector !== false);

/** The header's button: a column on and off where there is room, otherwise the panel over the text or the sheet. */
export function toggleInspector() {
  if (inspectorFits()) { UI.inspector = UI.inspector === false; saveUI(); peek = false; }
  else peek = !peek;
  applyInspector();
}
export function peekInspector(on) {
  peek = !!on;
  applyInspector();
}
/** Set the pane's classes and the button's state for the panel as it is. */
export function applyInspector() {
  const ed = pane();
  if (!ed) return;
  if (peek && inspectorFits() && UI.inspector !== false) peek = false; // the window grew: the column shows it
  ed.classList.toggle("insp-on", UI.inspector !== false);
  ed.classList.toggle("insp-peek", peek);
  const btn = ed.querySelector(".sn-insp-btn");
  if (btn) { const on = inspectorShown(); btn.classList.toggle("is-active", on); btn.setAttribute("aria-expanded", String(on)); }
}

/** The panel's frame, made with the note's pane (editor.js renderEditor); renderInspector fills it. */
export function inspectorPanel() {
  const aside = h("aside", { cls: "sn-insp", "aria-label": t("inspector") });
  const head = h("div", { cls: "sn-insp-head" },
    h("span", { cls: "sn-insp-grab", "aria-hidden": "true" }),
    ic("sn-insp-icon", "info"), h("span", { cls: "sn-insp-title", text: t("inspAbout") }),
    iconBtn("x", t("inspClose"), () => (peek ? peekInspector(false) : toggleInspector()), "sn-insp-close"));
  swipeToClose(aside, head);
  const body = h("div", { cls: "sn-insp-body" });
  aside.append(head, body);
  aside.secs = new Map();
  const scrim = h("div", { cls: "sn-insp-scrim", onClick: () => peekInspector(false) });
  return [aside, scrim];
}
/** On a phone the sheet goes away when its head is pulled down. */
function swipeToClose(aside, head) {
  let y0 = null;
  head.addEventListener("touchstart", (e) => { if (isPhone()) y0 = e.touches[0].clientY; }, { passive: true });
  head.addEventListener("touchmove", (e) => { if (y0 == null) return; const dy = Math.max(0, e.touches[0].clientY - y0); aside.style.transform = dy ? `translateY(${dy}px)` : ""; }, { passive: true });
  head.addEventListener("touchend", (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    aside.style.transform = "";
    if (dy > 80) peekInspector(false);
  });
}
/** A section: a head that folds it (kept per device) and a body that stays the same element across redraws, so a tag
 *  being typed in Properties keeps its text and the focus. */
function section(aside, key, icon, title) {
  let s = aside.secs.get(key);
  if (!s) {
    const count = h("span", { cls: "sn-insp-count" });
    const label = h("span", { cls: "sn-insp-sec-title" });
    const headBtn = h("button", { cls: "sn-insp-sec-head", type: "button" }, ic("", icon), label, count, ic("sn-insp-chev", "chevron-down"));
    const body = h("div", { cls: "sn-insp-sec-body" });
    const el = h("section", { cls: "sn-insp-sec", dataset: { sec: key } }, headBtn, body);
    headBtn.addEventListener("click", () => {
      const fold = { ...(UI.inspFold || {}) };
      if (fold[key]) delete fold[key]; else fold[key] = true;
      UI.inspFold = fold; saveUI();
      el.classList.toggle("is-collapsed", !!fold[key]);
      headBtn.setAttribute("aria-expanded", String(!fold[key]));
    });
    s = { el, body, label, count, headBtn };
    aside.secs.set(key, s);
  }
  const folded = !!UI.inspFold?.[key];
  s.el.classList.toggle("is-collapsed", folded);
  s.headBtn.setAttribute("aria-expanded", String(!folded));
  s.label.textContent = title;
  return s;
}

/** Fill the panel for the open note. Called with the note's properties (editor-toolbar.js renderEditorProps), so it
 *  follows every change to the note. */
export function renderInspector() {
  const aside = $("#editor .sn-insp");
  const path = editor.path, n = path && vault.notes.get(path);
  if (!aside || !n) return;
  const body = aside.querySelector(".sn-insp-body");
  const want = [];

  // Properties: the same rows as the editing view's, editable while reading too
  const props = section(aside, "props", "sliders-horizontal", t("properties"));
  props.count.textContent = "";
  if (n.fmError) props.body.replaceChildren(h("div", { cls: "sn-fm-error", text: t("fmError", { msg: n.fmError }) }));
  else fillProps(props.body, path, n, { selector: "#editor .sn-insp [data-sec=props] .sn-insp-sec-body" });
  want.push(props.el);

  // The checklist: how many of the note's boxes are ticked (the agenda's tasks are kept apart, in tasks.jsonl)
  const prog = cardTaskProgress(path);
  if (prog) {
    const s = section(aside, "tasks", "list-checks", t("factTasks"));
    s.count.textContent = `${prog.done}/${prog.n}`;
    const bar = h("span", { cls: "sn-facts-bar sn-insp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(prog.n), "aria-valuenow": String(prog.done), "aria-label": t("factDone", prog) }, h("span", {}));
    bar.firstChild.style.width = Math.round((prog.done / prog.n) * 100) + "%";
    s.body.replaceChildren(h("div", { cls: "sn-insp-line" }, bar)); // the count is in the head (2/6); the bar says it in words to a screen reader
    want.push(s.el);
  }

  // Outline: the note's headings, each one goes there
  const outline = noteOutline();
  if (outline?.hs.length) {
    const s = section(aside, "outline", "table-of-contents", wt("outline"));
    s.count.textContent = String(outline.hs.length);
    const min = Math.min(...outline.hs.map((x) => x.level));
    s.body.replaceChildren(h("nav", { cls: "sn-insp-toc" }, outline.hs.map((hd, i) => {
      const a = h("button", { cls: "sn-insp-toc-item", type: "button", text: hd.text, title: hd.text, onClick: () => outline.go(i) });
      a.style.setProperty("--toc-depth", String(Math.min(hd.level - min, 3)));
      return a;
    })));
    want.push(s.el);
  }

  // Links: the notes that link here, and the ones that name it without a link
  const links = section(aside, "links", "link", t("inspLinks"));
  const box = mentionsBox(path, "h4");
  links.count.textContent = box ? String(box.querySelectorAll(".sn-chip").length) : "";
  links.body.replaceChildren(box || h("div", { cls: "sn-insp-empty", text: t("inspNoLinks") }));
  want.push(links.el);

  // Info: the note's size and dates, and where its file is
  const info = section(aside, "info", "info", t("inspInfo"));
  const words = (n.body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  const dl = h("dl", { cls: "sn-insp-info" });
  const kv = (k, v, title) => dl.append(h("dt", { text: k }), h("dd", { text: v, title: title || v }));
  kv(t("inspWords"), words.toLocaleString());
  kv(t("inspChars"), n.body.length.toLocaleString());
  kv(t("inspCreated"), formatDate(n.ctime || n.mtime || 0), new Date(n.ctime || n.mtime || 0).toLocaleString());
  kv(t("factModified"), formatDate(n.mtime || 0), new Date(n.mtime || 0).toLocaleString());
  kv(t("inspFile"), path);
  info.count.textContent = "";
  info.body.replaceChildren(dl);
  want.push(info.el);

  // keep the panel's own scroll: put the sections in order without taking out the ones that stay
  want.forEach((el, i) => { if (body.children[i] !== el) body.insertBefore(el, body.children[i] || null); });
  while (body.children.length > want.length) body.lastChild.remove();
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !peek || document.querySelector(".modal-bg, .menu")) return;
  e.preventDefault(); e.stopPropagation();
  peekInspector(false);
}, true);
let pending = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(applyInspector); });
