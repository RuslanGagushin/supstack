/* =========================================================
   The editor's frontmatter panel, its keys, and the formatting toolbar with the commands it runs
   (insert, wrap, prefix lines, headings).
   ========================================================= */
import { LANG, t, wt } from "../core/i18n.js";
import { baseName } from "../core/util.js";
import { dumpYaml } from "../core/frontmatter.js";
import { formatTable } from "../core/tables.js";
import { editor, graph, PARENTS_FIELD, UI, vault } from "../services/state.js";
import { cardIcon } from "../services/vault.js";
import { $, h, ic, isMod, setIcon } from "./dom.js";
import { Menu } from "./ui.js";
import { addTags, fmTagList, promptAddParent, promptIcon, removeParent, removeTag, templateFor } from "./actions.js";
import { formatDate, parentChip } from "./cards.js";
import { openTagView } from "./board.js";
import { closeEditor, openEditor, renderEditor, saveEditor } from "./editor.js";
import { liveActivateEnd } from "./live-preview.js";
import { editorTable, editorTableKey, editorTableOp, tableMenu } from "./table-editor.js";
import { edSetHeading } from "./format-bar.js";
import { acKey, acUpdate, linkMention, setFocusMode, tagInputSuggest, unlinkedMentions } from "./completion.js";
import { orgEditorKey, orgLineIsEntry, orgToolbar } from "./org-editing.js";

let tagFocus = false;
const focusLost = () => !document.activeElement || document.activeElement === document.body;
export function renderEditorProps() {
  const path = editor.path;
  const n = vault.notes.get(path);
  const host = $("#editor-props");
  const foot = $("#editor-foot");
  if (!n) return;
  const field = PARENTS_FIELD;
  if (host && editor.mode === "read") {
    host.dataset.path = path;
    host.replaceChildren(infoLine(path, n));
  } else if (host && !n.fmError) {
    const oldIn = host.dataset.path === path ? host.querySelector(".sn-prop-input") : null;
    host.dataset.path = path;
    const draft = oldIn?.value || "", hadFocus = !!oldIn && oldIn === document.activeElement;
    host.replaceChildren();
    const props = h("div", { cls: "sn-props" + (editor.propsCollapsed ? " is-collapsed" : "") });
    const ph = h("div", { cls: "sn-props-head" }, ic("", "chevron-down"), h("span", { text: t("properties") }));
    ph.addEventListener("click", () => { editor.propsCollapsed = !editor.propsCollapsed; props.classList.toggle("is-collapsed", editor.propsCollapsed); });
    props.append(ph);
    const row = (iconName, key, ...val) => h("div", { cls: "sn-prop" }, h("div", { cls: "sn-prop-key" }, ic("", iconName), h("span", { text: key })), h("div", { cls: "sn-prop-val" }, ...val));
    // parents
    const pv = [];
    for (const p of graph.parentsOf(path).filter((x) => graph.has(x))) pv.push(parentChip(p, () => removeParent(path, p)));
    for (const u of graph.unresolvedParentsOf(path)) { const c = h("span", { cls: "sn-chip is-missing", title: t("parentMissing") }, ic("sn-chip-icon", "alert-triangle"), h("span", { text: u })); const x = ic("sn-chip-x", "x"); x.addEventListener("click", () => removeParent(path, u)); c.append(x); pv.push(c); }
    const addP = ic("sn-prop-add", "plus"); addP.title = t("menuAddParent"); addP.addEventListener("click", () => promptAddParent([path]));
    props.append(row("git-fork", field, ...pv, addP));
    // icon
    const icn = cardIcon(path);
    const ip = h("span", { cls: "sn-icon-pick" + (icn ? "" : " is-empty") }, ic("", icn || "circle-dashed", "circle-dashed"), h("span", { text: icn || t("noIcon") }));
    ip.addEventListener("click", () => promptIcon([path]));
    props.append(row("smile", "icon", ip));
    // tags (frontmatter)
    const fmTags = fmTagList(n.fm);
    const tagVals = fmTags.map((tg) => {
      const c = h("span", { cls: "sn-tag" }, "#" + tg);
      const x = ic("sn-chip-x", "x");
      x.addEventListener("click", () => removeTag(path, tg));
      c.append(x);
      return c;
    });
    const tagIn = h("input", { cls: "sn-prop-input", type: "text", placeholder: t("addTag") });
    // the panel redraws after the write: the new input takes the focus back, so tags can be typed one after another
    // only while the focus is nowhere (the redraw dropped it): a click elsewhere in the meantime wins
    const keepFocus = (p) => { tagFocus = true; p.finally(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (tagFocus && focusLost()) $("#editor-props .sn-prop-input")?.focus(); tagFocus = false; }))); };
    tagInputSuggest(tagIn, {
      exclude: () => new Set(fmTags.map((x) => x.toLowerCase())),
      onPick: (tag) => keepFocus(addTags([path], [tag])),
      onBackspace: () => { if (fmTags.length) keepFocus(removeTag(path, fmTags[fmTags.length - 1])); },
    });
    tagIn.value = draft;
    props.append(row("tags", "tags", ...tagVals, tagIn));
    // template
    const tpl = templateFor(path);
    if (tpl) props.append(row("layout-template", "child_template", h("a", { cls: "sn-chip", href: "#", onClick: (e) => { e.preventDefault(); openEditor(tpl); } }, ic("sn-chip-icon", "layout-template"), h("span", { text: baseName(tpl) }))));
    // others
    const known = new Set([field, "icon", "tags", "tag", "child_template"]);
    const others = Object.entries(n.fm).filter(([k]) => !known.has(k));
    for (const [k, v] of others) {
      const txt = typeof v === "object" && v !== null ? dumpYaml(v).trim() : String(v);
      props.append(row(k === "child_order" ? "list-ordered" : k === "order" ? "hash" : "text", k, h("span", { cls: "sn-prop-other", text: txt, title: t("otherProps") })));
    }
    host.append(props);
    if (hadFocus || (tagFocus && focusLost())) $("#editor-props .sn-prop-input")?.focus();
  }
  if (foot) {
    foot.replaceChildren();
    // what the notebook holds is its list (the board), not a block under its text
    const back = graph.backlinksOf(path);
    const unlinked = unlinkedMentions(path);
    // with mentions under it, the text keeps no empty room to click into: they follow it (spec UI-8)
    foot.closest(".sn-editor-page")?.classList.toggle("has-foot", !!(back.length || unlinked.length));
    if (!back.length && !unlinked.length) return;
    const box = h("div", { cls: "sn-editor-foot" });
    if (back.length) box.append(h("h4", { text: `${t("linkedMentions")} · ${back.length}` }), h("div", { cls: "sn-chips" }, back.map((k) => { const c = parentChip(k); c.onclick = (e) => { e.preventDefault(); openEditor(k); }; return c; })));
    if (unlinked.length) {
      box.append(h("h4", { text: `${wt("unlinked")} · ${unlinked.length}` }));
      const list = h("div", { cls: "sn-unlinked" });
      for (const u of unlinked) {
        const c = parentChip(u); c.onclick = (e) => { e.preventDefault(); openEditor(u); };
        list.append(h("div", { cls: "sn-unlinked-row" }, c, h("button", { cls: "wb-btn mini", type: "button", onClick: () => linkMention(u, path) }, ic("", "link"), wt("linkIt"))));
      }
      box.append(list);
    }
    foot.append(box);
  }
}
/** The reading view's line under the title, in place of Properties: when the note changed, its tags (each opens its list)
   and a notebook it names that doesn't exist. Its notebooks are in the header; the rest of the properties are one click
   away, in the editing view. */
function infoLine(path, n) {
  const line = h("div", { cls: "sn-info" });
  line.append(h("span", { cls: "sn-info-date", text: t("modifiedAt", { date: formatDate(n.mtime || 0) }), title: new Date(n.mtime || 0).toLocaleString(LANG) }));
  for (const u of graph.unresolvedParentsOf(path)) line.append(h("span", { cls: "sn-chip is-missing", title: t("parentMissing") }, ic("sn-chip-icon", "alert-triangle"), h("span", { text: u })));
  if (!n.fmError) for (const tg of fmTagList(n.fm)) line.append(h("button", { cls: "sn-tag sn-info-tag", type: "button", text: "#" + tg, onClick: () => openTagView(tg) }));
  return line;
}
export function editorKeys(e) {
  const ta = e.target;
  if (acKey(e)) return;
  if (orgEditorKey(e, ta)) return;
  const { selectionStart: s, selectionEnd: en, value } = ta;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const replace = (from, to, text, caretFrom, caretTo) => {
    if (ta.cmView) ta.setRangeText(text, from, to, "end");
    else { ta.setSelectionRange(from, to); document.execCommand("insertText", false, text) || (ta.setRangeText(text, from, to, "end")); }
    if (caretFrom != null) ta.setSelectionRange(caretFrom, caretTo ?? caretFrom);
    ta.dispatchEvent(new Event("input"));
  };
  if (e.key === "Escape" && UI.focus) { e.preventDefault(); e.stopPropagation(); setFocusMode(false); return; }
  if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation(); saveEditor(); ta.blur();
    if (innerWidth <= 820 || editor.wide) closeEditor();
    else $(`#board .sn-card[data-path="${CSS.escape(editor.path)}"]`)?.focus();
    return;
  }
  if (isMod(e) && e.key.toLowerCase() === "s") { e.preventDefault(); saveEditor(); return; }
  if (editorTableKey(e, ta)) return;
  if (isMod(e) && e.key.toLowerCase() === "l") { e.preventDefault(); edLinkStart(ta); return; }
  if (isMod(e) && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "i")) {
    e.preventDefault();
    const mark = e.key.toLowerCase() === "b" ? "**" : "*";
    const sel = value.slice(s, en);
    replace(s, en, mark + sel + mark, s + mark.length, en + mark.length);
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const blockEnd = value.indexOf("\n", en - (en > s && value[en - 1] === "\n" ? 1 : 0));
    const end = blockEnd < 0 ? value.length : blockEnd;
    const lines = value.slice(lineStart, end).split("\n");
    const out = e.shiftKey ? lines.map((l) => l.replace(/^(\t| {1,4})/, "")) : lines.map((l) => "\t" + l);
    const text = out.join("\n");
    const delta = out[0].length - lines[0].length;
    replace(lineStart, end, text, Math.max(lineStart, s + delta), lineStart + text.length - (end - en));
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !isMod(e) && s === en && !e.isComposing) {
    const line = value.slice(lineStart, s);
    const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX\/<>-]\]\s+)?/.exec(line);
    if (!m) return;
    e.preventDefault();
    // an empty item ends the list; the text goes on after a blank line (a line right under the list would join its last item)
    if (line.trim() === m[0].trim()) { const after = lineStart > 0 && /^\s*([-*+]|\d+[.)])\s/.test(value.slice(value.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1)) ? "\n" : ""; replace(lineStart, s, after, lineStart + after.length); return; }
    let marker = m[2];
    if (/^\d+/.test(marker)) marker = parseInt(marker, 10) + 1 + marker.slice(-1);
    replace(s, s, "\n" + m[1] + marker + m[3] + (m[4] ? "[ ] " : ""));
  }
}
export async function toggleReading() {
  if (editor.dirty) await saveEditor();
  editor.mode = editor.mode === "read" ? "edit" : "read";
  renderEditor();
  if (editor.mode === "edit") $(".sn-editor-text")?.focus();
  else $("#editor .sn-reading")?.setAttribute("tabindex", "-1"), $("#editor .sn-reading")?.focus({ preventScroll: true }); // the note stays where it was
}
/** Insert into the editor through the browser so Ctrl+Z keeps working. */
export function edInsert(ta, from, to, text, selFrom, selTo) {
  ta.focus();
  if (ta.cmView) ta.cmView.dispatch({ changes: { from, to, insert: text }, selection: selFrom != null ? { anchor: selFrom, head: selTo ?? selFrom } : { anchor: from + text.length } });
  else {
    ta.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, text)) ta.setRangeText(text, from, to, "end");
    if (selFrom != null) ta.setSelectionRange(selFrom, selTo ?? selFrom);
  }
  ta.dispatchEvent(new Event("input"));
}
export function edLinkStart(ta) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (e > s) return edInsert(ta, s, e, `[[${value.slice(s, e)}]]`);
  edInsert(ta, s, s, "[[]]", s + 2);
  acUpdate(ta);
}
export function edWrap(ta, mark, close = mark) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  if (sel.startsWith(mark) && sel.endsWith(close) && sel.length >= mark.length + close.length) return edInsert(ta, s, e, sel.slice(mark.length, sel.length - close.length), s, e - mark.length - close.length);
  edInsert(ta, s, e, mark + sel + close, s + mark.length, e + mark.length);
}
export function edLines(ta, fn) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const a = value.lastIndexOf("\n", s - 1) + 1;
  let b = value.indexOf("\n", e > s && value[e - 1] === "\n" ? e - 1 : e); if (b < 0) b = value.length;
  const lines = value.slice(a, b).split("\n");
  const out = fn(lines).join("\n");
  edInsert(ta, a, b, out, a + out.length, a + out.length);
}
const LIST_RE = /^(\s*)([-*+] \[[ xX\/<>-]\] |[-*+] |\d+[.)] )/;
export function edPrefix(ta, prefix) {
  edLines(ta, (lines) => {
    const all = lines.every((l) => !l.trim() || l.replace(/^\s*/, "").startsWith(prefix.replace(/\d+/, "")) || (prefix === "1. " && /^\s*\d+[.)] /.test(l)));
    return lines.map((l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      const ind = /^\s*/.exec(l)[0];
      const rest = l.slice(ind.length);
      if (all) return ind + rest.replace(prefix === "1. " ? /^\d+[.)] / : new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "");
      const clean = prefix === "> " ? rest : rest.replace(LIST_RE, "");
      return ind + (prefix === "1. " ? `${i + 1}. ` : prefix) + clean;
    });
  });
}
export function edHeading(ta) {
  edLines(ta, (lines) => lines.map((l) => {
    const m = /^(#{1,6}) /.exec(l);
    const lvl = m ? m[1].length : 0;
    const body = m ? l.slice(m[0].length) : l;
    return lvl >= 3 ? body : "#".repeat(lvl + 1) + " " + body;
  }));
}
export function renderEdToolbar() {
  const bar = h("div", { cls: "sn-ed-toolbar", role: "toolbar", "aria-label": "Formatting" });
  const ta = () => $(".sn-editor-text");
  const group = () => { const g = h("div", { cls: "sn-tb-group" }); bar.append(g); return g; };
  const btn = (g, icon, title, fn, key) => {
    const x = h("button", { type: "button", cls: "sn-tb-btn", title: key ? `${title} (${key})` : title, "aria-label": title, dataset: { act: icon } });
    setIcon(x, icon);
    x.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret in the text
    x.addEventListener("click", (e) => { const el = ta() || (editor.mode === "edit" ? liveActivateEnd() : null); if (el) fn(el, e); });
    g.append(x);
    return x;
  };
  const sep = () => bar.append(h("span", { cls: "sn-tb-sep", "aria-hidden": "true" }));
  let g = group();
  btn(g, "heading", t("tbHeading"), (el, e) => {
    const lvl = edLineState(el).heading;
    const m = new Menu();
    for (const [n, icon, label] of [[1, "heading-1", wt("c_h1")], [2, "heading-2", wt("c_h2")], [3, "heading-3", wt("c_h3")], [0, "pilcrow", wt("c_text")]])
      m.add(label, icon, () => { el.focus(); edSetHeading(el, n); }, { checked: lvl === n });
    m.showBelow(e.currentTarget);
  });
  sep(); g = group();
  btn(g, "bold", t("tbBold").replace(/ \(.*\)$/, ""), (el) => edWrap(el, "**"), "Ctrl+B");
  btn(g, "italic", t("tbItalic").replace(/ \(.*\)$/, ""), (el) => edWrap(el, "*"), "Ctrl+I");
  btn(g, "strikethrough", t("tbStrike"), (el) => edWrap(el, "~~"));
  btn(g, "highlighter", "Highlight", (el) => edWrap(el, "=="));
  btn(g, "code", t("tbCode"), (el) => edWrap(el, "`"));
  sep(); g = group();
  btn(g, "link", t("tbLink").replace(/ \(.*\)$/, ""), (el) => edLinkStart(el), "[[ · Ctrl+L");
  sep(); g = group();
  // the main set; a numbered list, a quote, an image and a code block are in "Insert /" (completion.js slashCommands)
  btn(g, "list", t("tbList"), (el) => edPrefix(el, "- "));
  btn(g, "list-checks", t("tbTask"), (el) => edPrefix(el, "- [ ] "));
  btn(g, "table", wt("c_table"), (el, e) => {
    const at = editorTable(el);
    if (at) { tableMenu((op) => editorTableOp(el, op, at), at.row).showBelow(e.currentTarget); return; }
    const s0 = el.selectionStart, v = el.value, pre = s0 > 0 && v[s0 - 1] !== "\n" ? "\n\n" : "";
    const f = formatTable({ rows: [["", ""], ["", ""]], align: ["", ""] });
    edInsert(el, s0, el.selectionEnd, pre + f.text + "\n", s0 + pre.length + f.cell(0, 0)[0]);
  });
  sep(); g = group();
  orgToolbar(btn, g);
  bar.append(h("span", { cls: "grow" }));
  const ins = h("button", { type: "button", cls: "sn-tb-insert", title: wt("slashHint") }, ic("sn-tb-insert-icon", "plus"), h("span", { cls: "sn-tb-insert-label", text: LANG === "ru" ? "Вставить" : "Insert" }), h("kbd", { text: "/" }));
  ins.addEventListener("mousedown", (e) => e.preventDefault());
  ins.addEventListener("click", () => {
    const el = ta() || (editor.mode === "edit" ? liveActivateEnd() : null); if (!el) return;
    el.focus();
    const s0 = el.selectionStart, v = el.value;
    const needSpace = s0 > 0 && !/\s/.test(v[s0 - 1]);
    edInsert(el, s0, el.selectionEnd, (needSpace ? " " : "") + "/");
    acUpdate(el);
  });
  bar.append(ins);
  scrollFades(bar);
  return bar;
}
/* A bar wider than the screen scrolls; its edge fades where more buttons are past it, so it shows that it does
   (spec UI-10). One bar at a time is watched: the open note's. */
const fadeSize = new ResizeObserver((entries) => entries.forEach((e) => updateFades(e.target)));
let fadeWatched = null;
function updateFades(bar) {
  bar.classList.toggle("fade-start", bar.scrollLeft > 1);
  bar.classList.toggle("fade-end", bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
}
function scrollFades(bar) {
  if (fadeWatched) fadeSize.unobserve(fadeWatched);
  fadeWatched = bar;
  fadeSize.observe(bar);
  bar.addEventListener("scroll", () => updateFades(bar), { passive: true });
}
/** Formatting at the caret, for the toolbar's active states. */
export function edLineState(ta) {
  const v = ta.value, s = ta.selectionStart;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", s); if (le < 0) le = v.length;
  const line = v.slice(ls, le), before = v.slice(ls, s);
  const hm = /^(#{1,6}) /.exec(line);
  const odd = (re) => ((before.match(re) || []).length % 2) === 1;
  const noBold = before.replace(/\*\*/g, "");
  return {
    heading: hm ? hm[1].length : 0,
    list: /^\s*[-*+] (?!\[[ xX\/<>-]\] )/.test(line), num: /^\s*\d+[.)] /.test(line), task: /^\s*[-*+] \[[ xX\/<>-]\] /.test(line), quote: /^\s*> /.test(line),
    bold: odd(/\*\*/g), italic: ((noBold.match(/\*/g) || []).length % 2) === 1,
    strikethrough: odd(/~~/g), highlighter: odd(/==/g), code: ((before.replace(/```/g, "").match(/`/g) || []).length % 2) === 1,
  };
}
export function updateEdToolbar() {
  const ta = $(".sn-editor-text"), bar = $("#editor .sn-ed-toolbar");
  if (!ta || !bar) return;
  const st = edLineState(ta);
  const map = { heading: st.heading > 0, bold: st.bold, italic: st.italic, strikethrough: st.strikethrough, highlighter: st.highlighter, code: st.code, list: st.list, "list-ordered": st.num, "list-checks": st.task, "text-quote": st.quote, "list-todo": orgLineIsEntry(ta) };
  for (const b of bar.querySelectorAll(".sn-tb-btn")) {
    const on = !!map[b.dataset.act];
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const hb = bar.querySelector('[data-act="heading"]');
  if (hb) setIcon(hb, st.heading ? `heading-${Math.min(st.heading, 6)}` : "heading");
}
