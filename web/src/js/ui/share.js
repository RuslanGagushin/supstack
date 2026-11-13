/* =========================================================
   "Share to Supstack" (spec TASK-6, Android): text or a link shared from another app arrives through the vault plugin;
   this asks where it goes — a line in today's note, or a new note in a notebook — and saves it.
   ========================================================= */
import { t } from "../core/i18n.js";
import { baseName } from "../core/util.js";
import { orgNowTs } from "../core/org.js";
import { lsGet, lsSet } from "../services/storage.js";
import { on } from "../services/events.js";
import { IS_ANDROID, vinvoke } from "../services/native.js";
import { graph, vault } from "../services/state.js";
import { dailyNotePath } from "../services/daily-notes.js";
import { txn, writeRaw } from "../services/save.js";
import { h, iconBtn } from "./dom.js";
import { echo, openLayer } from "./ui.js";
import { createCard } from "./actions.js";

const URL_RE = /^https?:\/\/\S+$/i;
let open = false;

/** What was shared: a title (the subject, or the first line, or the link's address) and the rest as text. */
export function sharedParts({ text = "", subject = "" }) {
  const body = String(text).replace(/\r\n/g, "\n").trim();
  const first = body.split("\n")[0].trim();
  const title = (String(subject).trim() || first).slice(0, 120);
  return { title, body: body === title ? "" : body };
}
/** Where shared text can go: today's note, the top level, then every notebook by name. */
function destinations() {
  const books = [...vault.notes.keys()].filter((p) => graph.childrenOf(p).length).sort((a, b) => baseName(a).localeCompare(baseName(b)));
  return [["daily", t("shareDaily")], ["root", t("shareRoot")], ...books.map((p) => ["book:" + p, t("shareIn", { name: baseName(p) })])];
}

/** Ask where the shared text goes and save it there. */
export function shareDialog(shared) {
  const { title: t0, body: b0 } = sharedParts(shared);
  if (!t0 && !b0) return;
  open = true;
  const panel = h("div", { cls: "modal sn-share", role: "dialog", "aria-label": t("shareTitle") });
  const close = openLayer(panel, () => { open = false; });
  const title = h("input", { type: "text", cls: "sn-share-title", value: t0, autocomplete: "off" });
  const body = h("textarea", { cls: "sn-share-body", rows: "5" });
  body.value = b0;
  const choices = destinations();
  const last = lsGet("sn-share-to", "daily");
  const to = h("select", { cls: "sn-share-to" }, choices.map(([v, l]) => h("option", { value: v, text: l, selected: v === last })));
  const save = async () => {
    const head = title.value.trim() || t("untitled");
    const text = body.value.replace(/\s+$/, "");
    lsSet("sn-share-to", to.value);
    close();
    if (to.value === "daily") {
      // a line in today's note, a link as a link, the text indented under it
      const path = dailyNotePath();
      const line = URL_RE.test(text) && !text.includes("\n") ? `- [${head}](${text}) ${orgNowTs()}` : `- ${head} ${orgNowTs()}`;
      const extra = URL_RE.test(text) && !text.includes("\n") ? [] : text.split("\n").filter(() => text.trim()).map((l) => "  " + l);
      const raw = vault.notes.get(path)?.raw ?? "";
      const next = (raw && !raw.endsWith("\n") ? raw + "\n" : raw) + [line, ...extra].join("\n") + "\n";
      await txn(t("shareSaved", { note: baseName(path) }), () => writeRaw(path, next));
    } else {
      const parent = to.value.startsWith("book:") ? to.value.slice(5) : null;
      await createCard(head, parent, text ? text + "\n" : "", undefined, { open: false });
      echo(t("shareSaved", { note: parent ? baseName(parent) : t("allCards") }));
    }
  };
  panel.append(iconBtn("x", t("close"), () => close(), "modal-close"), h("div", { cls: "modal-title", text: t("shareTitle") }),
    h("label", { cls: "cap-field" }, h("span", { text: t("shareHead") }), title),
    h("label", { cls: "cap-field" }, h("span", { text: t("shareText") }), body),
    h("label", { cls: "cap-field" }, h("span", { text: t("shareTo") }), to),
    h("div", { cls: "modal-buttons" }, h("button", { type: "button", text: t("shareCancel"), onClick: () => close() }), h("button", { type: "button", cls: "mod-cta", text: t("shareSave"), onClick: save })));
  setTimeout(() => title.focus(), 0);
}

/** Ask the vault plugin for something shared with the app (it keeps the last one until asked), once a vault is open. */
export async function checkShared() {
  if (!IS_ANDROID || !vault.fs || open) return;
  let r;
  try { r = await vinvoke("take_shared", {}); } catch { return; }
  if (r && (r.text || r.subject)) shareDialog(r);
}
if (IS_ANDROID) {
  // a share opens the app (or brings it back): look when the page shows and when a vault has opened
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkShared(); });
  window.addEventListener("focus", () => checkShared());
  on("opened", () => setTimeout(checkShared, 0));
}
