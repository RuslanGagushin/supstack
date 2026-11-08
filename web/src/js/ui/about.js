/* =========================================================
   The About tab of the settings: version, updates, release notes.
   ========================================================= */
import { LANG, st, ut } from "../core/i18n.js";
import { on } from "../services/events.js";
import { IS_ANDROID, IS_NATIVE, openExternal } from "../services/native.js";
import { saveUI, UI } from "../services/state.js";
import { APP_VERSION, appVersion, checkUpdate, installUpdate, RELEASES, upd } from "../services/updates.js";
import { h } from "./dom.js";
import { notice } from "./ui.js";
import { settingsModal } from "./shell.js";

/** The About tab of the settings: version, updates, release notes. */
export function aboutBody(item, toggle) {
  const ver = h("span", { text: APP_VERSION });
  appVersion().then((v) => (ver.textContent = v));
  const ua = navigator.userAgent;
  const platform = !IS_NATIVE ? ut("web") : IS_ANDROID ? "Android" : /Mac/i.test(ua) ? "macOS" : /Win/i.test(ua) ? "Windows" : "Linux";
  const out = [h("div", { cls: "sn-about" }, h("div", { cls: "sn-about-name", text: "Supstack" }), h("div", { cls: "sn-about-ver" }, ut("version") + " ", ver, " · " + platform))];
  if (IS_NATIVE) {
    const btn = h("button", { cls: "wb-btn", type: "button", onClick: () => (upd.state === "available" ? installUpdate() : checkUpdate()) });
    const row = item(ut("updates"), " ", btn);
    const desc = row.querySelector(".setting-item-description");
    row.classList.add("sn-update-row");
    upd.view = () => {
      const s = upd.state, v = upd.version;
      const pct = upd.total ? Math.min(100, Math.round((upd.got / upd.total) * 100)) + "%" : "";
      desc.textContent = s === "checking" ? ut("checking") : s === "current" ? ut("current") : s === "error" ? ut("error", { msg: upd.error })
        : s === "available" ? ut(upd.update || !IS_ANDROID ? "available" : "availableAndroid", { v }) : s === "installing" ? ut("downloading", { v, p: pct })
        : s === "restarting" ? ut("restarting") : UI.updateChecked ? ut("lastChecked", { time: new Date(UI.updateChecked).toLocaleString(LANG === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" }) }) : ut("never");
      btn.textContent = s === "available" ? ut(upd.update ? "install" : "download") : ut("check");
      btn.classList.toggle("is-cta", s === "available");
      btn.disabled = ["checking", "installing", "restarting"].includes(s);
      row.classList.toggle("is-available", s === "available");
    };
    upd.view();
    out.push(row, item(ut("auto"), ut("autoDesc"), toggle(UI.autoUpdate !== false, (v) => { UI.autoUpdate = v; saveUI(); })));
  } else out.push(h("p", { cls: "modal-text", text: ut("webNote") }));
  out.push(item(ut("releaseNotes"), ut("releaseNotesDesc"), h("button", { cls: "wb-btn", type: "button", text: st("open"), onClick: () => openExternal(RELEASES) })));
  return out;
}
on("update", () => notice(ut("availableNotice", { v: upd.version }), { keep: true, action: { label: ut("open"), run: () => settingsModal("about") } }));
