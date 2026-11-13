/* =========================================================
   Git sync — the vault folder is a git repository; syncing commits local changes,
   merges the remote branch and pushes (the work is done by the native "vault" plugin).
   Files changed on both sides keep this device's text; the other side is saved next to it
   as "name (conflict …).md". On Android the repository is a clone in the app's private
   storage that is mirrored to and from the picked folder.
   Settings (remote, branch, author…) are saved in the repository's own .git/config, which is
   never pushed, so they stay with the vault folder; this app keeps a copy for vaults
   that are not repositories yet. The access token is kept by the native side (the system's
   keychain on desktop, the clone's config in the app's private storage on Android), never in
   this page's storage.
   ========================================================= */
import { st } from "../core/i18n.js";
import { lsGet, lsSet } from "./storage.js";
import { emit } from "./events.js";
import { IS_NATIVE, vinvoke } from "./native.js";
import { vault } from "./state.js";
import { pollChanges } from "./vault.js";

export const GIT_DEFAULTS = { remote: "", branch: "main", username: "git", token: "", authorName: "", authorEmail: "", auto: true, minutes: 5 };
export const SS = { ...GIT_DEFAULTS }; // this vault's settings, changed in place
export const sync = { crash: "", busy: false, last: null, error: "", report: null, timer: null, debounce: null, dirty: false, info: null };

export const syncAvailable = () => !!(IS_NATIVE && vault.fs?.native);
const gitKey = () => "sn-git:" + vault.fs.root;
const gitConfigured = () => !!SS.remote.trim();
/** Sync is set up for this vault (it has a remote). */
export const syncConfigured = () => syncAvailable() && gitConfigured();

function loadSyncSettings(saved) { Object.assign(SS, GIT_DEFAULTS, lsGet(gitKey(), {}) || {}, saved || {}); }
/** This device's copy of the settings, without the token (versions up to 0.26 kept it here too). */
const saveLocal = () => lsSet(gitKey(), { ...SS, token: "" });
export function saveSyncSettings() { saveLocal(); saveRepoSettings(); scheduleAuto(); syncChanged(); }
/** Writes the settings into the repository's .git/config (creating the repository once there is a remote). */
async function saveRepoSettings() {
  const settings = { remote: SS.remote.trim(), branch: SS.branch.trim(), username: SS.username.trim(), token: SS.token,
    authorName: SS.authorName.trim(), authorEmail: SS.authorEmail.trim(), auto: !!SS.auto, minutes: Math.max(1, Number(SS.minutes) || 5) };
  try { await vinvoke("git_save_settings", { root: vault.fs.root, settings }); }
  catch (e) { emit("notice", st("failed", { msg: String(e?.message || e) })); }
}

/** Local edits: schedule a sync soon after the last one. */
export function syncHook() {
  if (!syncAvailable()) return;
  sync.dirty = true;
  if (!SS.auto || !gitConfigured()) return;
  clearTimeout(sync.debounce);
  sync.debounce = setTimeout(() => runSync({ quiet: true }), 30000);
}
function scheduleAuto() {
  clearInterval(sync.timer);
  sync.timer = null;
  if (syncAvailable() && SS.auto && gitConfigured()) sync.timer = setInterval(() => runSync({ quiet: true }), Math.max(1, Number(SS.minutes) || 5) * 60000);
}
export async function syncBoot() {
  if (!syncAvailable()) { syncChanged(); return; }
  loadSyncSettings();
  sync.last = null; sync.error = ""; sync.report = null; sync.dirty = false;
  sync.crash = "";
  try {
    const info = await vinvoke("git_info", { root: vault.fs.root });
    sync.crash = info.previousCrash || "";
    if (info.settings) { loadSyncSettings(info.settings); saveLocal(); }
    else {
      // a vault that is already a repository: take its remote
      if (!SS.remote && info.remote) { SS.remote = info.remote; if (info.branch) SS.branch = info.branch; }
      // settings from before they were kept in the repository move there
      if (gitConfigured()) { saveLocal(); await saveRepoSettings(); }
    }
  } catch { /* not a repository yet */ }
  if (lsGet(gitKey(), {})?.token) saveLocal(); // a token an older version left in this page's storage
  scheduleAuto();
  syncChanged();
  // after a crash, wait for the user instead of crashing again at every launch
  if (sync.crash) emit("notice", st("crashed"));
  else if (SS.auto && gitConfigured()) runSync({ quiet: true });
}
export async function stopSync() {
  clearInterval(sync.timer); clearTimeout(sync.debounce);
  sync.timer = sync.debounce = null;
  if (sync.dirty && gitConfigured() && !sync.busy && syncAvailable()) await runSync({ quiet: true });
}
export async function runSync({ quiet = false } = {}) {
  if (sync.busy || !syncAvailable()) return;
  if (!gitConfigured()) { if (!quiet) emit("sync-setup"); return; }
  sync.busy = true; sync.error = ""; sync.crash = "";
  syncChanged();
  try {
    await emit("flush");
    sync.dirty = false;
    const r = await vinvoke("git_sync", { root: vault.fs.root, config: {
      remote: SS.remote.trim(), branch: SS.branch.trim() || "main", username: SS.username.trim(), token: SS.token,
      authorName: SS.authorName.trim(), authorEmail: SS.authorEmail.trim() } });
    sync.report = r; sync.last = Date.now();
    if (r.pulled || r.conflicts.length) await pollChanges({ force: true });
    if (r.conflicts.length) emit("notice", st("conflictsNotice", { n: r.conflicts.length }));
    else if (!quiet) emit("notice", st("synced", { time: new Date(sync.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }));
  } catch (e) {
    sync.error = String(e?.message || e);
    if (!quiet) emit("notice", st("failed", { msg: sync.error }));
  } finally { sync.busy = false; syncChanged(); }
}

/* ---------- status button */
export function syncStatus() {
  if (!syncAvailable()) return { text: st("unavailable"), short: st("unavailableShort"), icon: "cloud-off", state: "off" };
  if (sync.busy) return { text: st("syncing"), short: st("syncingShort"), icon: "refresh-cw", state: "busy", spin: true };
  if (sync.crash) return { text: st("crashed"), short: st("failedShort"), icon: "alert-triangle", state: "warn" };
  if (sync.error) return { text: st("failed", { msg: sync.error }), short: st("failedShort"), icon: "alert-triangle", state: "warn" };
  if (!gitConfigured()) return { text: st("noRemote"), short: st("noRemoteShort"), icon: "git-branch", state: "warn" };
  if (!sync.last) return { text: st("never"), short: st("never"), icon: "git-branch", state: "off" };
  const time = new Date(sync.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { text: st("synced", { time }), short: time, icon: "check", state: sync.report?.conflicts?.length ? "warn" : "ok" };
}
function syncChanged() { emit("sync"); }

/* ---------- panel: status, sync now, settings */


