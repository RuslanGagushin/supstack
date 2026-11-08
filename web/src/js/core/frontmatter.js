/* =========================================================
   Frontmatter and note parsing (ports of src/note.ts, src/index/frontmatter.ts)
   ========================================================= */
import { formatMoment } from "./dates.js";

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
export function splitNote(data) {
  const m = FM_RE.exec(data);
  if (!m) return { fm: "", body: data };
  return { fm: m[0], body: data.slice(m[0].length) };
}
export function fmInner(fmBlock) { return fmBlock.replace(/^---\r?\n/, "").replace(/\r?\n---(?:\r?\n)?$/, ""); }
export function parseYaml(text) {
  const v = jsyaml.load(text, { schema: jsyaml.CORE_SCHEMA });
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
export function dumpYaml(obj) {
  return jsyaml.dump(obj, { schema: jsyaml.CORE_SCHEMA, lineWidth: -1, quotingType: '"', noRefs: true });
}
export function extractLinkpath(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(s);
  if (wiki) s = wiki[1];
  else {
    const md = /^\[[^\]]*\]\(([^)]+)\)$/.exec(s);
    if (md) { try { s = decodeURIComponent(md[1]); } catch { s = md[1]; } }
  }
  s = s.split("|")[0].split("#")[0].trim();
  return s || null;
}
export function parentLinkpaths(value) {
  const out = [];
  const visit = (v) => {
    if (Array.isArray(v)) {
      if (v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && typeof v[0][0] === "string") {
        const lp = extractLinkpath(v[0][0]);
        if (lp) out.push(lp);
        return;
      }
      v.forEach(visit);
      return;
    }
    const lp = extractLinkpath(v);
    if (lp) out.push(lp);
  };
  visit(value);
  return [...new Set(out)];
}
export function toStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => {
      if (Array.isArray(v) && v.length === 1 && typeof v[0] === "string") return [`[[${v[0]}]]`];
      return typeof v === "string" ? [v] : [];
    });
  }
  return typeof value === "string" && value.trim() ? [value] : [];
}
export const CODE_RE = /(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*|$)|`[^`\n]+`/g;
export function stripCode(s) { return s.replace(CODE_RE, " "); }
export const TAG_RE = /(^|[\s,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
export function noteTags(fm, body) {
  const out = [];
  const add = (x) => { const s = String(x).trim().replace(/^#/, ""); if (s) out.push("#" + s); };
  const ft = fm.tags ?? fm.tag;
  if (Array.isArray(ft)) ft.flat().forEach(add);
  else if (typeof ft === "string") ft.split(/[,\s]+/).forEach(add);
  const text = stripCode(body).replace(/%%[\s\S]*?%%/g, " ");
  for (const m of text.matchAll(TAG_RE)) add(m[2]);
  return [...new Set(out)];
}
export function noteLinks(body) {
  const out = [];
  const text = stripCode(body);
  for (const m of text.matchAll(/!?\[\[([^\]]+)\]\]/g)) { const lp = extractLinkpath(`[[${m[1]}]]`); if (lp) out.push(lp); }
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+\.md)\)/gi)) { const lp = extractLinkpath(`[x](${m[1]})`); if (lp && !/^[a-z]+:/i.test(lp)) out.push(lp); }
  return out;
}
export function fillTemplate(text, title, now) {
  const fmt = (d, f) => formatMoment(d, f);
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/gi, (_m, key, f) => {
    const k = key.toLowerCase();
    if (k === "title") return title;
    if (f) return fmt(now, f.trim());
    return fmt(now, k === "date" ? "YYYY-MM-DD" : "HH:mm");
  });
}
export function composeBody(templateBody, typed) {
  const tpl = templateBody.replace(/^\n+/, "").replace(/\n+$/, "");
  const extra = typed.trim();
  if (!tpl) return extra ? extra + "\n" : "";
  return extra ? `${tpl}\n\n${extra}\n` : `${tpl}\n`;
}
export const TEMPLATE_SKIP_KEYS = new Set(["child_order", "child_template", "order", "position", "tags_template"]);

