import { t, wt } from "../core/i18n.js";
import { baseName, dirName } from "../core/util.js";
import { editor, vault } from "../services/state.js";
import { cardIcon, linkText } from "../services/vault.js";
import { $, h, setIcon } from "./dom.js";
import { suggestModal } from "./ui.js";
import { sanitizeTitle } from "./actions.js";
import { edHeading, edInsert, edLines, edLineState, edLinkStart, edPrefix, edWrap, updateEdToolbar } from "./editor-toolbar.js";
import { ac, caretRect } from "./completion.js";

/* ---------- Floating format bar: shown over a selection in the editor text */
export function updateFmtBar(ta) {
  const has = ta && document.activeElement === ta && ta.selectionEnd > ta.selectionStart && editor.mode !== "read" && !ac.el;
  let bar = $(".sn-fmtbar");
  if (!has) { bar?.remove(); return; }
  if (!bar) {
    bar = h("div", { cls: "sn-fmtbar", role: "toolbar", "aria-label": "Formatting" });
    const btn = (icon, title, fn) => {
      const x = h("button", { type: "button", cls: "sn-tb-btn", title, "aria-label": title, dataset: { act: icon } });
      setIcon(x, icon);
      x.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
      x.addEventListener("click", () => { const el = $(".sn-editor-text"); if (!el) return; fn(el); updateEdToolbar(); updateFmtBar(el); });
      bar.append(x);
    };
    const sep = () => bar.append(h("span", { cls: "sn-tb-sep", "aria-hidden": "true" }));
    btn("bold", t("tbBold"), (el) => edWrap(el, "**"));
    btn("italic", t("tbItalic"), (el) => edWrap(el, "*"));
    btn("strikethrough", t("tbStrike"), (el) => edWrap(el, "~~"));
    btn("highlighter", wt("highlight"), (el) => edWrap(el, "=="));
    btn("code", t("tbCode"), (el) => edWrap(el, "`"));
    sep();
    btn("link", t("tbLink"), (el) => edLinkStart(el));
    sep();
    btn("heading", t("tbHeading"), (el) => edHeading(el));
    btn("list", t("tbList"), (el) => edPrefix(el, "- "));
    btn("list-checks", t("tbTask"), (el) => edPrefix(el, "- [ ] "));
    btn("text-quote", t("tbQuote"), (el) => edPrefix(el, "> "));
    document.body.append(bar);
  }
  const st = edLineState(ta);
  for (const b of bar.querySelectorAll(".sn-tb-btn")) b.classList.toggle("is-active", !!{ bold: st.bold, italic: st.italic, strikethrough: st.strikethrough, highlighter: st.highlighter, code: st.code, heading: st.heading > 0, list: st.list, "list-checks": st.task, "text-quote": st.quote }[b.dataset.act]);
  // above the start of the selection, or below its end when there is no room above
  const a = caretRect(ta, ta.selectionStart), z = caretRect(ta, ta.selectionEnd), r = ta.getBoundingClientRect();
  const w = bar.offsetWidth, hgt = bar.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, (a.top === z.top ? (a.left + z.left) / 2 : r.left + r.width / 2) - w / 2));
  const top = a.top - hgt - 8 >= 8 ? a.top - hgt - 8 : z.top + z.height + 8;
  Object.assign(bar.style, { left: left + "px", top: top + "px" });
}
export function edSetHeading(ta, n) {
  edLines(ta, (lines) => lines.map((l) => { const body = l.replace(/^#{1,6} /, ""); return n ? "#".repeat(n) + " " + body : body; }));
  updateEdToolbar();
}
/** Pick a note in a popup and insert a [[link]] at the caret. typedOpen — the user already typed "[[". */
async function linkPicker(ta, typedOpen) {
  const caret = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(caret, end);
  const items = [...vault.notes.keys()].sort((a, b) => (vault.notes.get(b).mtime - vault.notes.get(a).mtime)).map((p) => ({ value: p, title: baseName(p), icon: cardIcon(p) || "file-text", note: dirName(p) }));
  const pick = await suggestModal({ placeholder: t("insertLink"), items, allowCreate: true });
  ta.focus();
  if (!pick) { ta.setSelectionRange(caret, end); return; }
  const target = pick.create ? sanitizeTitle(pick.create) : linkText(pick.value);
  const label = sel && sel !== target ? `|${sel}` : "";
  if (typedOpen) {
    const hasClose = ta.value.slice(caret, caret + 2) === "]]";
    edInsert(ta, caret, hasClose ? caret + 2 : caret, `${target}${label}]]`);
  } else edInsert(ta, caret, end, `[[${target}${label}]]`);
}
export function downloadNote(path) {
  const n = vault.notes.get(path);
  if (!n) return;
  const a = h("a", { href: URL.createObjectURL(new Blob([n.raw], { type: "text/markdown" })), download: path.split("/").pop() });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

