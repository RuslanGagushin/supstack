/* =========================================================
   DOM helpers and icons
   ========================================================= */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || "");
const MAC_KEYS = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
/** A key's name as this system writes it: ⌘ ⌥ ⇧ on a Mac (the shortcuts take Cmd there, see isMod). */
export const keyName = (k) => (IS_MAC && MAC_KEYS[k]) || k;
/** Shortcuts inside a text ("Ctrl+Shift+D") as this system writes them: "⌘⇧D" on a Mac. */
export const keyText = (s) => (IS_MAC && s ? String(s).replace(/\b(Ctrl|Alt|Shift)\+/g, (_, k) => MAC_KEYS[k]).replace(/\b(Ctrl|Alt|Shift)\b/g, (k) => MAC_KEYS[k]) : s);
export function h(tag, props, ...children) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "cls") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "style") e.style.cssText = v;
      else if (k === "title") e.title = keyText(String(v));
      else if (k === "dataset") Object.assign(e.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
const pascal = (n) => n.replace(/^lucide-/, "").split(/[-_ ]+/).map((s) => (s ? s[0].toUpperCase() + s.slice(1) : "")).join("");
const svgCache = new Map();
function iconSvg(name) {
  if (!name) return null;
  if (svgCache.has(name)) return svgCache.get(name);
  const node = window.lucide?.icons?.[pascal(name)];
  let out = null;
  if (node) {
    const kids = (node[2] || []).map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
    out = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-${name}">${kids}</svg>`;
  }
  svgCache.set(name, out);
  return out;
}
export function setIcon(el, name, fallback = "file-text") { el.innerHTML = iconSvg(name) || iconSvg(fallback) || ""; return el; }
export function ic(cls, name, fallback) { return setIcon(h("span", { cls }), name, fallback); }
export function iconBtn(iconName, label, onClick, cls = "") {
  const b = h("button", { cls: "clickable-icon " + cls, "aria-label": label, title: label, type: "button" });
  setIcon(b, iconName);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
let ICON_NAMES = null;
export function allIconNames() {
  if (ICON_NAMES) return ICON_NAMES;
  const seen = new Set();
  const out = [];
  for (const [k, node] of Object.entries(window.lucide?.icons || {})) {
    const kebab = k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").replace(/([a-zA-Z])(\d)/g, "$1-$2").toLowerCase();
    const sig = JSON.stringify(node[2]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(kebab);
  }
  ICON_NAMES = out.sort();
  return out;
}
export const isMod = (e) => e.ctrlKey || e.metaKey;

