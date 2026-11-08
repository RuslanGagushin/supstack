/* =========================================================
   Markdown rendering (with wikilinks, embeds, tags, ==marks==, callouts, tasks)
   ========================================================= */
import { t, tt } from "../core/i18n.js";
import { esc } from "../core/util.js";
import { CODE_RE, extractLinkpath, splitNote } from "../core/frontmatter.js";
import { IS_NATIVE } from "../services/native.js";
import { editor, graph, vault } from "../services/state.js";
import { resolveAttachment, resolveFileLink, resolveLink } from "../services/vault.js";
import { attachmentUrl, IMG_EXT, PDF_EXT } from "../services/attachments.js";
import { orgLine, orgSetState, TASK_LINE_RE, taskState, taskStateName } from "../core/org.js";
import { txn, writeRaw } from "../services/save.js";
import { h, ic, isMod } from "./dom.js";
import { createCard } from "./actions.js";
import { openTagView, setTarget } from "./board.js";
import { openEditor, saveEditor } from "./editor.js";
import { refresh } from "./shell.js";
import { orgDecorate } from "./org-editing.js";
import { orgPickStateChar } from "./org-commands.js";
import { taskBox } from "./task-icons.js";
import { openAttachment } from "./files.js";

/* PDF embeds (![[doc.pdf#page=3&height=400]]): the platform's own viewer where the webview has one,
   pdf.js pages otherwise (Android's WebView, mobile browsers and the desktop app's webview show nothing for a PDF in a frame). */
export const PDFJS_VERSION = "4.10.38";
let pdfjsLoad = null;
function loadPdfjs() {
  pdfjsLoad ||= (async () => {
    // The app ships pdf.js next to the page (scripts/web.mjs); the plain web page falls back to the CDN.
    let err;
    for (const base of ["./pdfjs/", `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`]) {
      try {
        const lib = await import(new URL(base + "pdf.min.mjs", location.href).href);
        lib.GlobalWorkerOptions.workerSrc = new URL(base + "pdf.worker.min.mjs", location.href).href;
        return lib;
      } catch (e) { err = e; }
    }
    pdfjsLoad = null;
    throw err;
  })();
  return pdfjsLoad;
}
// The macOS app's WKWebView shows a blank frame for a blob: PDF, so the native app always uses the pdf.js it ships.
export const hasPdfViewer = () => !IS_NATIVE && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && navigator.pdfViewerEnabled !== false;
const openPdfs = new Set();
function pdfEmbed(target, sourcePath, full) {
  const [file, frag = ""] = target.split("#");
  const q = new URLSearchParams(frag);
  const page = Math.max(1, parseInt(q.get("page"), 10) || 1);
  const height = parseInt(q.get("height"), 10) || 0;
  const path = resolveAttachment(file, sourcePath);
  const meta = h("span", { cls: "sn-pdf-meta" });
  const head = h(full && path ? "div" : "span", { cls: "sn-pdf-head" + (full && path ? "" : " sn-pdf-chip") }, ic("sn-pdf-icon", "file-text"),
    h("a", { cls: "internal-link" + (path ? "" : " is-unresolved"), dataset: { href: file.trim() }, text: file.split("/").pop().trim() }), meta);
  if (!full || !path) return head;
  const view = h("div", { cls: "sn-pdf-view" });
  if (height) view.style.height = height + "px";
  if (hasPdfViewer()) attachmentUrl(path).then((u) => view.append(h("iframe", { src: `${u}#page=${page}&view=FitH`, title: file.trim() }))).catch((e) => pdfMessage(view, e));
  else renderPdfPages(view, meta, path, page);
  return h("div", { cls: "sn-pdf" }, head, view);
}
export function pdfMessage(view, e) { view.replaceChildren(h("div", { cls: "sn-pdf-msg", text: t("pdfFailed", { msg: String(e?.message || e) }) })); }
export async function renderPdfPages(view, meta, path, start) {
  for (const d of openPdfs) if (!d.view.isConnected) { openPdfs.delete(d); d.doc.destroy(); }
  view.classList.add("is-canvas");
  view.append(h("div", { cls: "sn-pdf-msg", text: t("pdfLoading") }));
  let doc;
  try {
    const lib = await loadPdfjs();
    const data = new Uint8Array(await (await vault.fs.readFile(path)).arrayBuffer());
    doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) { pdfMessage(view, e); return; }
  if (!view.isConnected) { doc.destroy(); return; }
  openPdfs.add({ view, doc });
  meta.textContent = t("pdfPages", { n: doc.numPages });
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const canvases = [];
  for (let i = 1; i <= doc.numPages; i++) canvases.push(h("canvas", { cls: "sn-pdf-page", style: `aspect-ratio: ${first.width} / ${first.height}`, dataset: { page: i } }));
  view.replaceChildren(...canvases);
  const draw = async (c) => {
    const p = await doc.getPage(+c.dataset.page);
    const base = p.getViewport({ scale: 1 });
    c.style.aspectRatio = `${base.width} / ${base.height}`;
    const vp = p.getViewport({ scale: Math.min(4, ((c.clientWidth || 600) * (window.devicePixelRatio || 1)) / base.width) });
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); draw(e.target).catch(() => {}); }
  }, { root: view, rootMargin: "300px 0px" });
  canvases.forEach((c) => io.observe(c));
  if (start > 1 && canvases[start - 1]) view.scrollTop = canvases[start - 1].offsetTop - 8;
}
const calloutFolds = new Map();
const calloutFoldKey = (path, type, title) => [path || "", type, title].join("\u0001");
function toggleCallout(c) {
  const folded = c.classList.toggle("is-collapsed");
  if (c.dataset.fold) calloutFolds.set(c.dataset.fold, folded);
}
const CALLOUT_ICONS = { note: "pencil", abstract: "clipboard-list", summary: "clipboard-list", tldr: "clipboard-list", info: "info", todo: "check-circle-2", tip: "flame", hint: "flame", important: "flame", success: "check", check: "check", done: "check", question: "help-circle", help: "help-circle", faq: "help-circle", warning: "alert-triangle", caution: "alert-triangle", attention: "alert-triangle", failure: "x", fail: "x", missing: "x", danger: "zap", error: "zap", bug: "bug", example: "list", quote: "quote", cite: "quote" };
/* Code blocks: a header with the language, line numbers and light syntax colours */
const CODE_LANGS = {};
for (const [names, label, badge, bg, fg, family] of [
  ["js javascript mjs cjs", "JavaScript", "JS", "#f7df1e", "#1b221f", "c"],
  ["ts typescript", "TypeScript", "TS", "#3178c6", "#fff", "c"],
  ["jsx", "JSX", "JSX", "#61dafb", "#1b221f", "sfc"],
  ["tsx", "TSX", "TSX", "#3178c6", "#fff", "sfc"],
  ["svelte", "Svelte", "S", "#ff3e00", "#fff", "sfc"],
  ["vue", "Vue", "V", "#42b883", "#fff", "sfc"],
  ["html htm", "HTML", "<>", "#e34f26", "#fff", "markup"],
  ["xml svg", "XML", "<>", "#8a6d3b", "#fff", "markup"],
  ["css scss less", "CSS", "#", "#663399", "#fff", "css"],
  ["json jsonc", "JSON", "{}", "#5b6761", "#fff", "json"],
  ["py python", "Python", "Py", "#3776ab", "#ffd43b", "hash"],
  ["rb ruby", "Ruby", "Rb", "#cc342d", "#fff", "hash"],
  ["sh bash zsh shell", "Shell", "$", "#2e3632", "#fff", "hash"],
  ["yml yaml", "YAML", "Y", "#cb171e", "#fff", "hash"],
  ["toml", "TOML", "T", "#9c4221", "#fff", "hash"],
  ["rs rust", "Rust", "Rs", "#b7410e", "#fff", "c"],
  ["go golang", "Go", "Go", "#00add8", "#fff", "c"],
  ["c h", "C", "C", "#555d9b", "#fff", "c"],
  ["cpp c++ cc hpp", "C++", "C+", "#00599c", "#fff", "c"],
  ["cs csharp", "C#", "C#", "#68217a", "#fff", "c"],
  ["java", "Java", "J", "#b07219", "#fff", "c"],
  ["kt kotlin", "Kotlin", "K", "#7f52ff", "#fff", "c"],
  ["swift", "Swift", "Sw", "#f05138", "#fff", "c"],
  ["php", "PHP", "P", "#777bb4", "#fff", "c"],
  ["sql", "SQL", "Q", "#336791", "#fff", "sql"],
  ["md markdown", "Markdown", "M", "#5b6761", "#fff", null],
]) for (const name of names.split(" ")) CODE_LANGS[name] = { label, badge, bg, fg, family };
const CODE_KEYWORDS = new Set("abstract as async await break case catch class const continue crate debugger def default defer del do done echo elif else elsif end enum esac except export extends extern false fi final finally fn for foreach from func function go if impl implements import in instanceof interface is lambda let loop match mod module mut namespace new nil None not null or override package pass private protected public pub raise return self static struct super switch then this throw throws trait true True False try type typeof undefined use val var void where while with yield".split(" "));
const CODE_SQL_KEYWORDS = new Set("add alter and as asc between by case create delete desc distinct drop else end exists false from group having if in index inner insert into is join key left like limit not null on or order outer primary references right select set table then true union unique update values when where".split(" "));
const CODE_STR = { dq: String.raw`"(?:[^"\\\n]|\\.)*"`, sq: String.raw`'(?:[^'\\\n]|\\.)*'`, bt: "`(?:[^`\\\\]|\\\\[^])*`" };
const CODE_C_COMMENT = String.raw`//.*|/\*[^]*?\*/`, CODE_TAG = String.raw`</?[A-Za-z][\w:.-]*|/?>`;
const CODE_FAMILIES = {
  c: { com: CODE_C_COMMENT, str: `${CODE_STR.dq}|${CODE_STR.sq}|${CODE_STR.bt}`, kw: CODE_KEYWORDS },
  sfc: { com: `<!--[^]*?-->|${CODE_C_COMMENT}`, str: `${CODE_STR.dq}|${CODE_STR.sq}|${CODE_STR.bt}`, tag: CODE_TAG, kw: CODE_KEYWORDS },
  markup: { com: "<!--[^]*?-->", str: CODE_STR.dq, tag: CODE_TAG },
  css: { com: String.raw`/\*[^]*?\*/`, str: `${CODE_STR.dq}|${CODE_STR.sq}` },
  json: { str: CODE_STR.dq, kw: new Set(["true", "false", "null"]) },
  hash: { com: String.raw`(?:^|[ \t])#.*`, str: `"""[^]*?"""|'''[^]*?'''|${CODE_STR.dq}|${CODE_STR.sq}`, kw: CODE_KEYWORDS },
  sql: { com: String.raw`--.*|/\*[^]*?\*/`, str: `${CODE_STR.dq}|${CODE_STR.sq}`, kw: CODE_SQL_KEYWORDS, nocase: true, notypes: true },
};
for (const f of Object.values(CODE_FAMILIES)) {
  const part = (name, src) => (src ? `(?<${name}>${src})|` : "");
  f.re = new RegExp(`${part("com", f.com)}${part("str", f.str)}${part("tag", f.tag)}(?<num>\\b0x[\\da-fA-F]+|\\b\\d[\\d_]*(?:\\.\\d+)?)|(?<word>[\\p{L}_$][\\p{L}\\p{N}_$]*)`, "gmu");
}
function highlightCode(text, family) {
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const m of text.matchAll(family.re)) {
    const g = m.groups;
    let cls = g.com ? "tok-com" : g.str ? "tok-str" : g.tag ? "tok-tag" : g.num ? "tok-num" : null;
    if (g.word) {
      if (family.kw?.has(family.nocase ? g.word.toLowerCase() : g.word)) cls = "tok-kw";
      else if (family.kw && !family.notypes && /^\p{Lu}/u.test(g.word)) cls = "tok-type";
    }
    if (!cls) continue;
    frag.append(text.slice(pos, m.index), h("span", { cls, text: m[0] }));
    pos = m.index + m[0].length;
  }
  frag.append(text.slice(pos));
  return frag;
}
const CODE_HIGHLIGHT_LIMIT = 30000; // a huge block stays plain instead of slowing the render
function decorateCodeBlocks(el) {
  for (const pre of el.querySelectorAll("pre")) {
    const code = pre.firstElementChild;
    if (code?.tagName !== "CODE") continue;
    const lang = (/\blanguage-(\S+)/.exec(code.className)?.[1] || "").toLowerCase();
    const known = Object.hasOwn(CODE_LANGS, lang) ? CODE_LANGS[lang] : null;
    const text = code.textContent.replace(/\n$/, "");
    const family = CODE_FAMILIES[known?.family];
    code.replaceChildren(family && text.length <= CODE_HIGHLIGHT_LIMIT ? highlightCode(text, family) : text);
    const mark = known ? h("span", { cls: "code-badge", text: known.badge }) : ic("code-icon", "code");
    if (known) Object.assign(mark.style, { background: known.bg, color: known.fg });
    const gutter = h("div", { cls: "code-gutter", "aria-hidden": "true" });
    gutter.append(...text.split("\n").map(() => h("span")));
    const box = h("div", { cls: "code-block" }, h("div", { cls: "code-head" }, mark, h("span", { text: known?.label || lang || t("codePlain") })));
    pre.replaceWith(box);
    box.append(h("div", { cls: "code-body" }, gutter, pre));
  }
}
/** A table's frame scrolls only for a table really wider than it: WebKit rounds a full-width table a pixel over, which would show a scrollbar. */
const tableWide = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const wrap = target.closest(".sn-table-wrap");
    if (!wrap?.isConnected) { tableWide.unobserve(target); continue; }
    wrap.classList.toggle("is-wide", wrap.scrollWidth > wrap.clientWidth + 1);
  }
});
export function renderMarkdown(md, sourcePath, opts = {}) {
  const codes = [];
  let s = md.replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*|$)|`[^`\n]+`/g, (m) => { codes.push(m); return `${codes.length - 1}`; });
  s = s.replace(/%%[\s\S]*?%%/g, "");
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (m, inner) => {
    const [target, alias] = inner.split("|");
    const tpath = target.split("#")[0].trim();
    if (IMG_EXT.test(tpath)) {
      const w = alias && /^\d+(x\d+)?$/.test(alias.trim()) ? ` width="${alias.trim().split("x")[0]}"` : "";
      return `<img class="sn-embed-img" data-embed="${esc(tpath)}" alt="${esc(alias && !w ? alias : tpath)}"${w}>`;
    }
    if (PDF_EXT.test(tpath)) return `<span class="sn-embed-pdf" data-embed="${esc(target.trim())}"></span>`;
    return `<span class="internal-embed"><a class="internal-link" data-href="${esc(target)}">${esc(alias || target)}</a></span>`;
  });
  s = s.replace(/\[\[([^\]]+)\]\]/g, (m, inner) => {
    const [target, alias] = inner.split("|");
    const lpath = extractLinkpath(`[[${target}]]`);
    const res = resolveLink(lpath, sourcePath) || resolveFileLink(lpath, sourcePath);
    const shown = alias || target.replace(/#\^?/, " › ");
    return `<a class="internal-link${res ? "" : " is-unresolved"}" data-href="${esc(target)}">${esc(shown)}</a>`;
  });
  s = s.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  s = s.replace(/(^|[\s,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu, (m, pre, tag) => `${pre}<a class="tag" data-tag="${esc(tag)}">#${esc(tag)}</a>`);
  s = s.replace(/(\d+)/g, (m, i) => codes[+i]);
  let html = marked.parse(s, { gfm: true, breaks: true });
  html = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-href", "data-embed", "data-tag"] });
  const el = opts.into || document.createElement("div");
  el.innerHTML = html;
  // Callouts
  for (const bq of el.querySelectorAll("blockquote")) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== "P") continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>\n?|\n|$)/.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase(), title = m[3].trim() || type[0].toUpperCase() + type.slice(1);
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.innerHTML.trim()) p.remove();
    const c = h("div", { cls: "callout", dataset: { callout: type } },
      h("div", { cls: "callout-title" }, ic("callout-icon", CALLOUT_ICONS[type] || "pencil"), h("span", { cls: "callout-title-inner", text: title })),
      h("div", { cls: "callout-content" }, ...bq.childNodes));
    if (!c.lastChild.textContent.trim() && !c.lastChild.children.length) c.lastChild.remove();
    else if (m[2]) {
      // [!type]+ starts open, [!type]- folded; a fold the reader toggled stays while the note is open
      const key = calloutFoldKey(sourcePath, type, title);
      c.dataset.fold = key;
      c.classList.add("is-collapsible");
      c.classList.toggle("is-collapsed", calloutFolds.get(key) ?? m[2] === "-");
      c.firstChild.append(ic("callout-fold", "chevron-down"));
    }
    bq.replaceWith(c);
  }
  for (const tb of el.querySelectorAll("table")) { const wrap = h("div", { cls: "sn-table-wrap" }); tb.replaceWith(wrap); wrap.append(tb); tableWide.observe(wrap); tableWide.observe(tb); }
  // Tasks: a list item's box ([ ] and [x] come as checkboxes, [/] [<] [-] [>] as text) becomes its state's icon,
  // numbered in the order TASK_LINE_RE finds the boxes in the text
  let ti = 0;
  for (const li of el.querySelectorAll("li")) {
    const host = li.firstElementChild?.tagName === "P" && !li.firstChild.textContent.trim() ? li.firstElementChild : li;
    let first = host.firstChild;
    while (first?.nodeType === 3 && !first.data.trim() && first.nextSibling) first = first.nextSibling;
    let ch = null;
    if (first?.nodeType === 1 && first.tagName === "INPUT" && first.type === "checkbox") { ch = first.checked ? "x" : " "; first.replaceWith(); }
    else if (first?.nodeType === 3) {
      const m = /^\s*\[([ xX\/<>-])\](?=\s|$)/.exec(first.data);
      if (m) { ch = m[1]; first.data = first.data.slice(m[0].length); }
    }
    const st = ch != null && taskState(ch);
    if (!st) continue;
    host.prepend(taskBox(st.ch, { dataset: { task: String(ti++) } }, { square: true }));
    li.classList.add("task-list-item", "is-state-" + st.id);
    li.dataset.task = st.ch; // the state's character, as Obsidian themes and snippets expect (li[data-task="/"])
    if (!st.open) li.classList.add("is-checked");
  }
  for (const a of el.querySelectorAll("a[href]")) {
    if (a.classList.contains("internal-link")) continue;
    const href = a.getAttribute("href") || "";
    if (/^[a-z][\w+.-]*:/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
    else if (/\.md(#.*)?$/i.test(href) || !/^#/.test(href)) { a.classList.add("internal-link"); a.dataset.href = decodeURIComponent(href.replace(/\.md(#.*)?$/i, "")); a.removeAttribute("href"); }
  }
  for (const d of el.querySelectorAll("span.sn-embed-pdf[data-embed]")) {
    const box = pdfEmbed(d.dataset.embed, sourcePath, !!opts.pdf);
    // A block viewer cannot sit inside a paragraph: split the paragraph around it
    const p = d.parentElement?.tagName === "P" ? d.parentElement : null;
    if (!p || !box.classList.contains("sn-pdf")) { d.replaceWith(box); continue; }
    const rest = h("p");
    while (d.nextSibling) rest.append(d.nextSibling);
    d.remove();
    p.after(box, rest);
    while (p.lastChild && (p.lastChild.nodeName === "BR" || !p.lastChild.textContent.trim() && p.lastChild.nodeType === 3)) p.lastChild.remove();
    while (rest.firstChild && (rest.firstChild.nodeName === "BR" || !rest.firstChild.textContent.trim() && rest.firstChild.nodeType === 3)) rest.firstChild.remove();
    for (const x of [p, rest]) if (!x.childNodes.length) x.remove();
  }
  for (const img of el.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    const name = img.dataset.embed || (src && !/^(https?:|data:|blob:)/i.test(src) ? src : null);
    if (!name) continue;
    img.removeAttribute("src");
    const path = resolveAttachment(name, sourcePath);
    if (path) attachmentUrl(path).then((u) => { img.src = u; }).catch(() => {});
  }
  try { orgDecorate(el, sourcePath); } catch (err) { console.warn(err); }
  decorateCodeBlocks(el);
  return el;
}
export function wireRendered(el, sourcePath) {
  el.addEventListener("click", (e) => {
    const a = e.target.closest("a.internal-link");
    if (a) {
      e.preventDefault(); e.stopPropagation();
      const lp = extractLinkpath(`[[${a.dataset.href}]]`);
      const p = resolveLink(lp, sourcePath);
      const file = p ? null : resolveFileLink(lp, sourcePath);
      if (file) openAttachment(file);
      else if (p) { if (isMod(e) || !graph.has(p)) openEditor(p); else setTarget(p); }
      else createCard(lp || a.textContent, null, "", undefined, { open: true });
      return;
    }
    const tg = e.target.closest("a.tag");
    if (tg) { e.preventDefault(); e.stopPropagation(); openTagView(tg.dataset.tag); return; }
    const ct = e.target.closest(".callout.is-collapsible > .callout-title");
    if (ct) { e.preventDefault(); e.stopPropagation(); toggleCallout(ct.parentElement); }
  });
  el.addEventListener("click", (e) => {
    const tb = e.target.closest(".task-box[data-task]");
    if (tb) { e.preventDefault(); e.stopPropagation(); toggleTask(sourcePath, +tb.dataset.task); }
  });
  el.addEventListener("contextmenu", async (e) => {
    const tb = e.target.closest(".task-box[data-task]");
    if (!tb) return;
    e.preventDefault(); e.stopPropagation();
    const ch = await orgPickStateChar(tb.dataset.state);
    if (ch !== undefined) setTaskState(sourcePath, +tb.dataset.task, ch);
  });
}
/** A click on a task's box: tick an open task, reopen a closed one. */
export const toggleTask = (path, index) => setTaskState(path, index, (cur) => (taskState(cur)?.open ? "x" : " "));
/** Put the note's index-th box (in TASK_LINE_RE's order) into state `ch` (or `ch(current)`), as one undoable edit. */
export async function setTaskState(path, index, ch) {
  if (!vault.notes.has(path)) return;
  if (editor.path === path && editor.dirty) await saveEditor();
  const raw = vault.notes.get(path)?.raw;
  if (raw == null) return;
  const { fm, body } = splitNote(raw);
  const masked = body.replace(CODE_RE, (m) => m.replace(/\[/g, "\u0001"));
  const re = new RegExp(TASK_LINE_RE.source, "gm");
  let m, i = -1;
  while ((m = re.exec(masked)) && ++i < index);
  if (!m) return;
  const to = typeof ch === "function" ? ch(m[2]) : ch;
  const lines = raw.split("\n"), li = (fm + body.slice(0, m.index)).split("\n").length - 1;
  let msg;
  if (orgLine(lines[li])?.box != null) msg = orgSetState(lines, li, to);
  else { lines[li] = lines[li].replace(/\[[ xX\/<>-]\]/, `[${to}]`); msg = tt("stateTo", { kw: taskStateName(to) }); } // a task inside a quote or callout
  if (!msg) return;
  await txn(msg, () => writeRaw(path, lines.join("\n")));
  refresh();
}

