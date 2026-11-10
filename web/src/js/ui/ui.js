/* =========================================================
   UI: menus, modals, notices
   ========================================================= */
import { t } from "../core/i18n.js";
import { norm } from "../core/util.js";
import { on } from "../services/events.js";
import { vault } from "../services/state.js";
import { undo } from "../services/save.js";
import { $, $$, allIconNames, h, ic, keyName, keyText } from "./dom.js";

export let openMenuEl = null;
export function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }
export class Menu {
  constructor() { this.items = []; }
  add(title, iconName, onClick, o = {}) { this.items.push({ title, icon: iconName, onClick, ...o }); return this; }
  sep() { if (this.items.length && this.items[this.items.length - 1] !== "sep") this.items.push("sep"); return this; }
  label(text) { this.items.push({ label: text }); return this; }
  showAt(x, y) {
    closeMenu();
    const m = h("div", { cls: "menu", role: "menu" });
    const items = this.items.filter((it, i, a) => !(it === "sep" && (i === 0 || i === a.length - 1)));
    for (const it of items) {
      if (it === "sep") { m.append(h("div", { cls: "menu-separator" })); continue; }
      if (it.label) { m.append(h("div", { cls: "menu-label", text: it.label })); continue; }
      const row = h("div", { cls: "menu-item" + (it.warning ? " is-warning" : "") + (it.disabled ? " is-disabled" : ""), role: "menuitem" },
        it.icon ? ic("menu-item-icon", it.icon) : h("span", { cls: "menu-item-icon" }), h("span", { cls: "menu-item-title", text: it.title }),
        it.checked ? ic("menu-item-check", "check") : null);
      row.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); it.onClick?.(e); });
      m.append(row);
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    m.style.top = Math.max(8, y + r.height > innerHeight - 8 ? y - r.height : y) + "px";
    openMenuEl = m;
  }
  showAtEvent(e) {
    e.preventDefault?.(); e.stopPropagation?.();
    if (e.clientX || e.clientY) this.showAt(e.clientX, e.clientY);
    else { const r = (e.currentTarget || e.target).getBoundingClientRect(); this.showAt(r.left, r.bottom + 4); }
  }
  showBelow(el) { const r = el.getBoundingClientRect(); this.showAt(r.left, r.bottom + 4); }
}
document.addEventListener("mousedown", (e) => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

let echoTimer = null;
export function defaultEcho() {
  if (vault.fs?.kind === "demo") return t("demoBanner");
  if (vault.fs?.kind === "copy") return t("volatileBanner");
  return ""; // the line stays hidden until there is a message
}
/** The vault whose standing note has had its turn: the note shows once per vault, as a quiet pill that goes after a
   few seconds, and then only the sidebar's vault row carries it, so it never sits over the cards. */
let standingShownFor = null;
/** The toast: one message at a time, floating over the page (bottom centre; at the top on phones). A new message replaces
   the last; it goes after a few seconds unless it keeps (o.keep) or offers an action. With nothing to say it shows the
   vault's standing note (a demo or a copy) once, as a quiet pill, or nothing. */
function toastBox() {
  let box = $("#toast");
  if (!box) document.body.append((box = h("div", { id: "toast", cls: "sn-toast is-blank", role: "status", "aria-live": "polite" })));
  return box;
}
export function echo(text, o = {}) {
  const box = toastBox();
  text = keyText(text || "");
  clearTimeout(echoTimer);
  let isDefault = !!text && text === defaultEcho();
  if (isDefault && !o.undo && !o.action) {
    if (standingShownFor === vault.fs) { text = ""; isDefault = false; } // already shown for this vault: back to nothing
    else { standingShownFor = vault.fs; echoTimer = setTimeout(() => echo(""), 8000); }
  }
  const quiet = isDefault || !!o.hint;
  box.replaceChildren();
  box.classList.toggle("is-quiet", quiet);
  box.classList.toggle("is-blank", !text && !o.undo && !o.action);
  if (text) box.append(h("span", { cls: "sn-toast-text", text, title: text }));
  if (o.undo) box.append(h("button", { cls: "sn-toast-btn", type: "button", onClick: () => { echo(defaultEcho(), { keep: true }); undo(); } }, t("undo"), h("kbd", { text: keyText("Ctrl+Z") })));
  if (o.action) box.append(h("button", { cls: "sn-toast-btn", type: "button", text: o.action.label, onClick: () => { echo(defaultEcho(), { keep: true }); o.action.run(); } }));
  if (text && !isDefault && (o.keep || o.action)) box.append(h("button", { cls: "sn-toast-x", type: "button", "aria-label": t("close"), title: t("close"), text: "×", onClick: () => echo(defaultEcho(), { keep: true }) }));
  if (!quiet && (text || o.undo || o.action)) { box.classList.remove("is-new"); void box.offsetWidth; box.classList.add("is-new"); }
  if (!o.keep && !o.action && !isDefault && (text || o.undo)) echoTimer = setTimeout(() => echo(defaultEcho(), { keep: true }), o.undo ? 9000 : o.hint ? 12000 : 6000);
  return true;
}
/** The footer of a popup: key hints such as ↵ choose · esc dismiss */
export function promptKeys(...pairs) {
  return h("div", { cls: "prompt-instructions" }, pairs.map(([k, label]) => h("span", {}, h("kbd", { text: keyText(k) }), label)));
}
/** A popup with a title and one text field (the look of the command palette). Returns { panel, input, close }; close(v) resolves onClose(v), Escape gives undefined. */
export function promptPanel(label, { value = "", placeholder = "", extra = [], keys, onClose } = {}) {
  const input = h("input", { cls: "prompt-input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: placeholder || label, "aria-label": label });
  input.value = value;
  const panel = h("div", { cls: "prompt mod-ask" }, h("div", { cls: "prompt-title", text: label.replace(/[….:]+$/, "") }), h("div", { cls: "prompt-input-row" }, input), ...extra,
    promptKeys(...(keys || [["↵", t("confirm")], ["esc", t("dismiss")]])));
  const close = openLayer(panel, onClose);
  return { panel, input, close };
}
export function notice(text, o = {}) { echo(String(text).replace(/\n/g, " · "), o); }

export let modalStack = 0;
export function openLayer(panel, onClose) {
  const bg = h("div", { cls: "modal-bg" });
  const close = (v) => { bg.remove(); panel.remove(); modalStack--; document.removeEventListener("keydown", onKey, true); onClose?.(v); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(undefined); } };
  bg.addEventListener("mousedown", () => close(undefined));
  document.addEventListener("keydown", onKey, true);
  document.body.append(bg, panel);
  modalStack++;
  return close;
}
export function fuzzyScore(q, text) {
  if (!q) return 1;
  const s = norm(text);
  const words = norm(q).split(/\s+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    const i = s.indexOf(w);
    if (i < 0) {
      let j = 0;
      for (const ch of s) if (ch === w[j]) j++;
      if (j < w.length) return 0;
      score += 0.2;
    } else score += i === 0 ? 3 : /[\s/_-]/.test(s[i - 1]) ? 2 : 1;
  }
  return score;
}
/** Suggest modal (pick from a filtered list). items: [{value,title,icon,color,note}] */
export function suggestModal({ placeholder, items, allowCreate = false, grid = false, render, limit = 200, current }) {
  return new Promise((resolve) => {
    const input = h("input", { cls: "prompt-input", type: "text", placeholder, spellcheck: "false", autocomplete: "off", "aria-label": placeholder });
    const results = h("div", { cls: "prompt-results" + (grid ? " icon-grid" : "") });
    const panel = h("div", { cls: "prompt" }, h("div", { cls: "prompt-input-row" }, input), results,
      promptKeys(["↑↓", t("navigate")], ["↵", t("choose")], ["esc", t("dismiss")]));
    let shown = [], sel = 0;
    const close = openLayer(panel, (v) => resolve(v));
    const choose = (i) => { const it = shown[i]; if (it) close(it); };
    const draw = () => {
      const q = input.value.trim();
      shown = items.map((it) => ({ it, s: fuzzyScore(q, it.title + " " + (it.keywords || "")) })).filter((x) => x.s > 0);
      if (q) shown.sort((a, b) => b.s - a.s);
      shown = shown.slice(0, limit).map((x) => x.it);
      if (allowCreate && q && !items.some((it) => norm(it.title) === norm(q))) shown.push({ create: q, title: t("createNew", { name: q }), icon: "plus" });
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      results.replaceChildren();
      if (!shown.length) results.append(h("div", { cls: "suggestion-empty", text: t("noResults") }));
      shown.forEach((it, i) => {
        if (!q && it.group && it.group !== shown[i - 1]?.group) results.append(h("div", { cls: "suggestion-group", text: it.group }));
        const row = render ? render(it) : h("div", { cls: "suggestion-item" },
          it.icon ? ic("suggestion-icon", it.icon) : null, h("span", { cls: "suggestion-title", text: it.title }), it.note ? h("span", { cls: "suggestion-note", text: it.note }) : null,
          it.checked ? ic("suggestion-check", "check") : null,
          it.keys ? h("span", { cls: "suggestion-keys" }, it.keys.map((k) => h("kbd", { text: keyName(k) }))) : null);
        row.classList.add("suggestion-item");
        if (current !== undefined && it.value === current) row.classList.add("is-current");
        if (i === sel) row.classList.add("is-selected");
        row.addEventListener("mousemove", () => { if (sel !== i) { sel = i; mark(); } });
        row.addEventListener("click", () => choose(i));
        results.append(row);
      });
    };
    const mark = () => { $$(".suggestion-item", results).forEach((r, i) => r.classList.toggle("is-selected", i === sel)); $$(".suggestion-item", results)[sel]?.scrollIntoView({ block: "nearest" }); };
    input.addEventListener("input", () => { sel = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      const cols = grid ? Math.max(1, Math.round(results.clientWidth / 122)) : 1;
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + cols); mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - cols); mark(); }
      else if (grid && e.key === "ArrowRight" && input.selectionStart === input.value.length) { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
      else if (grid && e.key === "ArrowLeft" && input.selectionStart === 0) { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    });
    draw();
    input.focus(); // at once, so keys typed right after the shortcut land in the input
    setTimeout(() => input.focus(), 0);
  });
}
export async function iconModal(current) {
  const names = allIconNames();
  const items = [{ value: null, title: t("noIcon"), icon: "circle-slash" }, ...names.map((n) => ({ value: n, title: n, icon: n }))];
  const pick = await suggestModal({
    placeholder: t("pickIcon"), items, grid: true, limit: 160, current,
    render: (it) => h("div", { cls: "suggestion-item", title: it.title }, ic("suggestion-icon", it.icon), h("span", { cls: "suggestion-title", text: it.title })),
  });
  return pick ? pick.value : undefined;
}
export function promptModal(title, value = "") {
  return new Promise((resolve) => {
    const { input, close } = promptPanel(title, { value, onClose: (v) => resolve(v ?? null) });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); close(input.value.trim() || null); } });
    input.focus(); input.select();
    setTimeout(() => { if (document.activeElement !== input) input.focus(); }, 0);
  });
}
export function confirmModal(title, text, okText) {
  return new Promise((resolve) => {
    const ok = h("button", { cls: "mod-warning", text: okText });
    const panel = h("div", { cls: "modal" }, h("div", { cls: "modal-title", text: title }), h("p", { cls: "modal-text", text }),
      h("div", { cls: "modal-buttons" }, h("button", { text: t("close"), onClick: () => close(false) }), ok));
    const close = openLayer(panel, (v) => resolve(!!v));
    ok.addEventListener("click", () => close(true));
    setTimeout(() => ok.focus(), 0);
  });
}

on("notice", (text, opts) => notice(text, opts));
