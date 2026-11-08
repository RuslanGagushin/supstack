/* =========================================================
   Git sync on screen: the status button, and the Git tab of the settings.
   ========================================================= */
import { st } from "../core/i18n.js";
import { on } from "../services/events.js";
import { GIT_DEFAULTS, runSync, saveSyncSettings, SS, sync, syncAvailable, syncConfigured, syncStatus } from "../services/sync.js";
import { $, h, ic } from "./dom.js";
import { notice } from "./ui.js";
import { settingsModal } from "./shell.js";

function renderSyncButton() {
  const b = $("#sync-btn");
  if (!b) return;
  const s = syncStatus();
  // nothing to show where sync can't run or isn't set up (Settings › Git sets it up); words only when it is busy or
  // needs attention, else a quiet icon
  b.hidden = !syncAvailable() || (!syncConfigured() && !sync.busy && !sync.crash && !sync.error);
  b.className = `wb-btn wb-sync is-${s.state}` + (s.spin ? " is-spin" : "");
  b.title = s.text;
  b.replaceChildren(ic("wb-sync-icon", s.icon, "refresh-cw"), ...(s.state === "busy" || s.state === "warn" ? [h("span", { cls: "wb-label", text: s.short })] : []));
}
export function syncButton() {
  const b = h("button", { id: "sync-btn", type: "button", cls: "wb-btn wb-sync" });
  b.addEventListener("click", () => openSyncPanel());
  setTimeout(renderSyncButton, 0);
  return b;
}
function openSyncPanel() { if (!syncAvailable()) { notice(st("unavailable")); return; } syncSettingsModal(); }
function renderSyncPanel() { sync.panel?.render(); }
export function syncSettingsModal() {
  if (!syncAvailable()) { notice(st("unavailable")); return; }
  settingsModal("sync");
}
/** The Git tab of the settings: status, sync now, remote and access. `item` and `toggle` are the settings' row builders. */
export function syncSettingsBody(item, toggle, heading = () => null) {
  const text = (key, ph, type = "text", after) => { const i = h("input", { type, placeholder: ph || "", spellcheck: "false", autocomplete: "off" }); i.value = String(SS[key] ?? ""); i.addEventListener("change", () => { SS[key] = type === "number" ? Number(i.value) || GIT_DEFAULTS[key] : i.value.trim(); saveSyncSettings(); after?.(); }); return i; };
  const status = h("div", { cls: "sn-sync-status" });
  const result = h("p", { cls: "sn-sync-note" });
  const syncBtn = h("button", { cls: "mod-cta", type: "button", text: st("syncNow"), onClick: async () => { await runSync(); } });
  const render = () => {
    const s = syncStatus();
    status.className = `sn-sync-status is-${s.state}` + (s.spin ? " is-spin" : "");
    status.replaceChildren(ic("", s.icon), h("span", { text: s.text }));
    const r = sync.report;
    result.textContent = sync.crash && !sync.busy ? st("crashNote", { steps: sync.crash }) : !r ? "" : r.conflicts.length ? st("conflicts", { n: r.conflicts.length }) : [r.pulled && st("pulled"), r.pushed && st("pushed")].filter(Boolean).join(", ") || st("upToDate");
    syncBtn.disabled = sync.busy;
  };
  sync.panel = { render };
  render();
  return [status, result,
    heading(st("groupRepo")),
    item(st("remote"), st("remoteDesc"), text("remote", "https://github.com/you/notes.git")),
    item(st("branch"), null, text("branch", "main")),
    item(st("username"), st("usernameDesc"), text("username", "git")),
    item(st("token"), st("tokenDesc"), text("token", "", "password")),
    heading(st("groupCommits")),
    item(st("authorName"), null, text("authorName", "Supstack")),
    item(st("authorEmail"), null, text("authorEmail", "you@example.com")),
    heading(st("groupAuto")),
    item(st("auto"), st("autoDesc"), toggle(SS.auto, (v) => { SS.auto = v; saveSyncSettings(); })),
    item(st("minutes"), null, text("minutes", "5", "number")),
    h("p", { cls: "sn-sync-note", text: st("note") }),
    h("div", { cls: "modal-buttons" }, syncBtn)];
}
on("sync", () => { renderSyncButton(); if (sync.panel) renderSyncPanel(); });
on("sync-setup", () => syncSettingsModal());
