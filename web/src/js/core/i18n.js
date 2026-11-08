/* =========================================================
   i18n: the page's language and the lookup functions for the string tables in core/strings.js.
   Every table is { en: {key: text}, ru: {key: text} }; a text may hold {vars} and may be a list
   of plural forms ([one, few, many] in Russian, [one, other] in English), picked by vars.n.
   ========================================================= */
import { CSTR, FSTR, FVSTR, NSTR, STR, SYNC_STR, TSTR, USTR, WSTR } from "./strings.js";

export let LANG = "en";
export const setLang = (l) => { LANG = l === "ru" ? "ru" : "en"; };
export function pluralIndex(n) {
  if (LANG === "ru") {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 0;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
    return 2;
  }
  return n === 1 ? 0 : 1;
}
/** The lookup function of one table: text in the current language, else English, else the key itself. */
function scoped(table) {
  return (key, vars = {}) => {
    let s = table[LANG]?.[key] ?? table.en[key] ?? key;
    if (Array.isArray(s)) s = s[Math.min(pluralIndex(vars.n ?? 0), s.length - 1)];
    if (typeof s !== "string") return s; // a table of names, such as the date picker's "every"
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  };
}
export const t = scoped(STR); // the board, tree, editor and settings
export const tt = scoped(TSTR); // TODOs and the agenda
export const ct = scoped(CSTR); // the date picker
export const ft = scoped(FSTR); // folding in the editor
export const wt = scoped(WSTR); // writing: completion, attachments, daily notes, outline
export const fvt = scoped(FVSTR); // the Files view
export const st = scoped(SYNC_STR); // Git sync
export const nt = scoped(NSTR); // the native app
export const ut = scoped(USTR); // version and updates
