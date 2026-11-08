/* =========================================================
   Small helpers for strings and paths.
   ========================================================= */

export const debounce = (fn, ms) => { let tm; const d = (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(tm); return d; };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const baseName = (p) => (p.split("/").pop() || p).replace(/\.md$/i, "");
export const dirName = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е");
/** A note's Markdown as one line of plain text, for a preview: no code, embeds, link syntax, list and heading marks, tables or emphasis. */
export function plainText(md, max = 300) {
  return String(md)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, " ")
    .replace(/!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
    .replace(/\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, (m, a, b) => b || a.split("#")[0])
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}[-:| \t]*$/gm, " ")
    .replace(/^[ \t]*(?:>[ \t]*)+(?:\[![^\]\n]*\][+-]?)?/gm, "")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?)/gm, "")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~|==|\*|`)/g, "")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
