/* =========================================================
   Version and updates.
   The desktop apps update themselves from GitHub Releases: the Tauri updater downloads the new
   build, checks its signature, installs it and the app restarts. Android can't replace its own APK,
   so it compares with the latest release and opens the APK download. The web page has nothing to
   install; it only shows its version.
   ========================================================= */
import { emit } from "./events.js";
import { IS_ANDROID, IS_NATIVE, openExternal } from "./native.js";
import { saveUI, UI } from "./state.js";

export const APP_VERSION = "__APP_VERSION__"; // the page's own version (the apps ask Tauri for theirs); scripts/page.mjs puts package.json's here
const REPO = "RuslanGagushin/supstack";
export const RELEASES = `https://github.com/${REPO}/releases`;
/** state: idle | checking | current | available | installing | restarting | error. `update` is the Tauri updater's handle (desktop only). */
export const upd = { state: "idle", version: "", url: "", error: "", got: 0, total: 0, update: null, view: null };
const canSelfUpdate = () => IS_NATIVE && !IS_ANDROID && !!window.__TAURI__?.updater;
export async function appVersion() {
  try { if (IS_NATIVE) return await window.__TAURI__.app.getVersion(); } catch { /* older shell: the page's version */ }
  return APP_VERSION;
}
/** Is version a newer than b? Compares major.minor.patch, ignoring a leading v. */
export function isNewer(a, b) {
  const p = (v) => String(v).replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
function setUpd(o) { Object.assign(upd, o); upd.view?.(); }
export async function checkUpdate({ quiet = false } = {}) {
  if (!IS_NATIVE || ["checking", "installing", "restarting"].includes(upd.state)) return;
  setUpd({ state: "checking", error: "" });
  try {
    let found = false;
    if (canSelfUpdate()) {
      try {
        const u = await window.__TAURI__.updater.check();
        setUpd(u ? { state: "available", version: u.version, update: u, url: `${RELEASES}/tag/v${u.version}` } : { state: "current", update: null });
        found = true;
      } catch (e) { console.warn("updater: no signed update manifest, asking GitHub instead", e); }
    }
    if (!found) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error("GitHub " + r.status);
      const rel = await r.json();
      const version = String(rel.tag_name || "").replace(/^v/, "");
      const apk = IS_ANDROID && (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
      setUpd(isNewer(version, await appVersion()) ? { state: "available", version, update: null, url: apk?.browser_download_url || rel.html_url || RELEASES } : { state: "current", update: null });
    }
    UI.updateChecked = Date.now();
    saveUI();
  } catch (e) { setUpd({ state: "error", error: String(e?.message || e) }); }
  upd.view?.();
  if (quiet && upd.state === "available" && !upd.view) emit("update");
}
export async function installUpdate() {
  if (!upd.update) { openExternal(upd.url || RELEASES); return; }
  setUpd({ state: "installing", got: 0, total: 0 });
  try {
    await emit("flush");
    await upd.update.downloadAndInstall((e) => {
      if (e.event === "Started") setUpd({ total: e.data?.contentLength || 0 });
      else if (e.event === "Progress") setUpd({ got: upd.got + (e.data?.chunkLength || 0) });
    });
    setUpd({ state: "restarting" });
    await window.__TAURI__.process.relaunch();
  } catch (e) { setUpd({ state: "error", error: String(e?.message || e) }); }
}
/** Check on launch (after a few seconds) and twice a day while the app stays open, unless turned off. */
export function startUpdateChecks() {
  if (!IS_NATIVE) return;
  const autoCheck = () => { if (UI.autoUpdate !== false && upd.state !== "available") checkUpdate({ quiet: true }); };
  setTimeout(autoCheck, 8000);
  setInterval(autoCheck, 12 * 3600e3);
}
