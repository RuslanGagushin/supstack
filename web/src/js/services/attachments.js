/* =========================================================
   Attachments: the vault's non-note files — their URLs for display, where pasted files are saved,
   and which notes link to a file.
   ========================================================= */
import { formatMoment } from "../core/dates.js";
import { stripCode } from "../core/frontmatter.js";
import { vault } from "./state.js";
import { ATTACHMENTS, vaultFolder } from "./folders.js";
import { addAttachment, isMd, resolveAttachment } from "./vault.js";
import { syncHook } from "./sync.js";

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const blobUrls = new Map();
export async function attachmentUrl(path) {
  if (blobUrls.has(path)) return blobUrls.get(path);
  const p = (async () => { const f = await vault.fs.readFile(path); return URL.createObjectURL(f); })();
  blobUrls.set(path, p);
  return p;
}
export const PDF_EXT = /\.pdf$/i;
/** Files the system would run rather than show: programs, scripts, installers, shortcuts. The desktop app shows them in
 *  their folder instead of opening them (one may have come in through git from someone else's repository), and
 *  src-tauri/capabilities/default.json refuses to open them as well (tests/files.test.mjs checks the two lists agree). */
export const RUNNABLE_EXTS = [
  "exe", "com", "bat", "cmd", "msi", "msp", "scr", "pif", "cpl", "ps1", "psm1", "vbs",
  "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "url", "reg", "jar", "appref-ms", "msc",
  "inf", "app", "command", "tool", "sh", "zsh", "bash", "csh", "ksh", "fish", "pkg", "mpkg",
  "dmg", "scpt", "scptd", "applescript", "workflow", "terminal", "webloc", "inetloc", "fileloc", "action", "prefpane", "desktop",
  "run", "bin", "appimage",
];
const RUNNABLE_RE = new RegExp(`\\.(${RUNNABLE_EXTS.join("|")})$`, "i");
/** May the system's default app open this vault file? Not a runnable one, nor a name without an extension (a program may have none), nor anything inside a macOS app bundle. */
export const opensSafely = (path) => { const name = fileName(path); return /.\.[^.]+$/.test(name) && !RUNNABLE_RE.test(name) && !/\.app\//i.test(path); };
export const fileExt = (p) => (/\.([^./]+)$/.exec(p)?.[1] || "").toLowerCase();
export const fileName = (p) => p.split("/").pop();
export function allAttachments() { return [...vault.allPaths].filter((p) => !isMd(p)); }
export function dropAttachment(path) {
  const k = fileName(path).toLowerCase();
  const arr = vault.files.get(k);
  if (arr) { const i = arr.indexOf(path); if (i >= 0) arr.splice(i, 1); if (!arr.length) vault.files.delete(k); }
  const u = blobUrls.get(path);
  if (u) { blobUrls.delete(path); u.then((x) => URL.revokeObjectURL(x)).catch(() => {}); }
}
/* links to files in a note: [[file.pdf]], ![[img.png|300]], ![alt](folder/img%20one.png) */
export const FILE_WIKI_RE = /(!?\[\[)([^\]|#\n]+)([^\]\n]*\]\])/g;
export const FILE_MD_RE = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;
export function fileTarget(lp, source, md) {
  let s = lp.trim();
  if (md) { s = s.replace(/^<|>$/g, ""); if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; s = s.split("#")[0]; }
  if (!s || isMd(s) || !/\.[a-z0-9]{1,8}$/i.test(s)) return null;
  return resolveAttachment(s, source);
}
/** path of every attachment -> notes that link to it */
export function attachmentRefs() {
  const out = new Map();
  const add = (f, p) => { const arr = out.get(f) || out.set(f, []).get(f); if (!arr.includes(p)) arr.push(p); };
  for (const n of vault.notes.values()) {
    const raw = stripCode(n.raw);
    for (const m of raw.matchAll(FILE_WIKI_RE)) { const f = fileTarget(m[2], n.path, false); if (f) add(f, n.path); }
    for (const m of raw.matchAll(FILE_MD_RE)) { const f = fileTarget(m[2], n.path, true); if (f) add(f, n.path); }
  }
  return out;
}
export async function moveVaultFile(from, to) {
  const file = await vault.fs.readFile(from); // a Blob keeps its type (the demo vault serves it as is)
  if (from.toLowerCase() === to.toLowerCase()) { // case-only rename on a case-insensitive disk: go through a temporary name
    const tmp = to + ".sn-tmp-" + Date.now().toString(36);
    await vault.fs.write(tmp, file); await vault.fs.remove(from); await vault.fs.write(to, await vault.fs.readFile(tmp)); await vault.fs.remove(tmp);
  } else { await vault.fs.write(to, file); await vault.fs.remove(from); }
  return file.size;
}
/** Every attachment goes into attachments/ (services/folders.js). */
const attachmentFolderFor = () => vaultFolder(ATTACHMENTS);
export async function saveAttachment(file, notePath, pasted) {
  const folder = attachmentFolderFor();
  const ext = (file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1) : (file.type.split("/")[1] || "png").replace("jpeg", "jpg")).toLowerCase();
  const stem = pasted || !file.name ? `Pasted image ${formatMoment(new Date(), "YYYYMMDDHHmmss")}` : file.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "file";
  let path = (folder ? folder + "/" : "") + `${stem}.${ext}`, i = 1;
  while (vault.allPaths.has(path)) path = (folder ? folder + "/" : "") + `${stem} ${i++}.${ext}`;
  const buf = await file.arrayBuffer();
  await vault.fs.write(path, buf);
  vault.allPaths.add(path);
  vault.sizes.set(path, buf.byteLength);
  vault.mtimes.set(path, Date.now());
  addAttachment(path);
  syncHook("create", path);
  return path;
}
/** The first image a note shows (an embed of an image file in the vault), for its thumbnail in the list of notes; null without one. */
export function firstImage(path) {
  const n = vault.notes.get(path);
  if (!n || !/!\[/.test(n.body)) return null;
  const body = stripCode(n.body);
  let best = null;
  for (const [re, md] of [[FILE_WIKI_RE, false], [FILE_MD_RE, true]]) {
    for (const m of body.matchAll(re)) {
      if (best && m.index > best.i) break;
      if (!m[1].startsWith("!")) continue;
      const f = fileTarget(m[2], path, md);
      if (f && IMG_EXT.test(f)) { best = { i: m.index, f }; break; }
    }
  }
  return best?.f ?? null;
}
