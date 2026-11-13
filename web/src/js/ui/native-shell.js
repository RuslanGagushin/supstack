/* =========================================================
   The page inside the native app: picking and reopening vault folders, links that open outside,
   and Android's back button.
   ========================================================= */
import { LANG } from "../core/i18n.js";
import { t } from "../core/i18n.js";
import { lsSet } from "../services/storage.js";
import { IS_ANDROID, IS_NATIVE, NativeFS, openExternal, TAURI, vinvoke } from "../services/native.js";
import { board, editor, saveUI, UI, vault } from "../services/state.js";
import { $ } from "./dom.js";
import { closeMenu, notice, openMenuEl } from "./ui.js";
import { goBack } from "./board.js";
import { closeEditor } from "./editor.js";
import { loadVault, setSide } from "./shell.js";
import { setFocusMode } from "./completion.js";
import { orgCapture } from "./agenda.js";

export async function nativePick() {
  try {
    const r = await vinvoke("pick", {});
    if (!r) return;
    lsSet("sn-native-last", r);
    await loadVault(new NativeFS(r.root, r.name));
  } catch (e) { notice(String(e?.message || e)); }
}
export async function nativeReopen(r) {
  try {
    if (!(await vinvoke("exists", { root: r.root, path: "" }))) throw new Error((LANG === "ru" ? "Нет доступа к папке: " : "Can't reach the folder: ") + r.name);
    await loadVault(new NativeFS(r.root, r.name));
  } catch (e) { notice(String(e?.message || e)); }
}

/* Quick capture from anywhere (spec TASK-5, desktop app): a system-wide shortcut brings the window forward and opens
   the capture form. Settings › Keyboard shortcuts changes it or turns it off (UI.captureKey: "" is off). */
export const CAPTURE_KEY_DEFAULT = "CommandOrControl+Alt+N";
export const captureShortcutAvailable = IS_NATIVE && !IS_ANDROID;
export const captureKey = () => (UI.captureKey == null ? CAPTURE_KEY_DEFAULT : UI.captureKey);
/** Hand the shortcut to the app; false, with a message, when the system refuses it (taken by another app, or not a shortcut). */
export async function setCaptureKey(key) {
  if (!captureShortcutAvailable) return false;
  try { await TAURI.invoke("set_capture_shortcut", { shortcut: key || null }); }
  catch (e) { notice(t("captureKeyFailed", { key, msg: String(e?.message || e) })); return false; }
  UI.captureKey = key || "";
  saveUI();
  return true;
}
if (captureShortcutAvailable) {
  window.__TAURI__?.event?.listen("quick-capture", () => { if (vault.fs) orgCapture(); }).catch(() => {});
  if (captureKey()) setCaptureKey(captureKey());
}

if (IS_NATIVE) {
  document.documentElement.classList.add("is-native");
  if (IS_ANDROID) document.documentElement.classList.add("is-android");
  // links with target=_blank would silently do nothing inside the app window
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") || "";
    if (/^(https?|mailto|tel):/i.test(href)) { e.preventDefault(); openExternal(href); }
  }, true);
  // Android back button: close what's open, then go back, then leave the app
  if (IS_ANDROID) {
    history.replaceState({ sn: 0 }, "");
    history.pushState({ sn: 1 }, "");
    addEventListener("popstate", () => {
      const consumed = (() => {
        if (document.querySelector(".modal-bg")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; }
        if (openMenuEl) { closeMenu(); return true; }
        if (!vault.fs) return false;
        if (UI.focus) { setFocusMode(false); return true; }
        if (editor.path) { closeEditor(); return true; }
        if (!$("#app").classList.contains("side-closed") && innerWidth <= 820) { setSide(false); return true; }
        if (board.history.length) { goBack(); return true; }
        return false;
      })();
      if (consumed) history.pushState({ sn: 1 }, "");
      else history.back();
    });
  }
}


