/* =========================================================
   Start-up: theme and language, the folder picker fallback, watching the vault for outside
   changes, and reopening the last vault.
   ========================================================= */
import { HandleFS, idb, MemoryFS } from "../services/fs.js";
import { IS_NATIVE, lastNative, NativeFS, vinvoke } from "../services/native.js";
import { board, editor, graph, vault } from "../services/state.js";
import { pollChanges } from "../services/vault.js";
import { startUpdateChecks } from "../services/updates.js";
import { h } from "./dom.js";
import { saveEditor } from "./editor.js";
import { applyLanguage, applyTheme, loadVault } from "./shell.js";
import { demoVault, hasFsApi, loadCopy, showWelcome } from "./welcome.js";

/** On launch, go straight back into the last vault when that needs no prompt; the welcome screen stays as the fallback. */
async function autoReopen() {
  try {
    if (IS_NATIVE) {
      const ln = lastNative();
      if (ln && (await vinvoke("exists", { root: ln.root, path: "" }))) await loadVault(new NativeFS(ln.root, ln.name));
    } else if (hasFsApi) {
      const last = await idb.get("lastVault");
      if (last && (await last.queryPermission({ mode: "readwrite" })) === "granted") await loadVault(new HandleFS(last));
    }
  } catch (e) { /* keep the welcome screen */ }
}
export function boot() {
  applyTheme();
  applyLanguage();
  const folderInput = h("input", { type: "file", id: "folder-input", webkitdirectory: true, multiple: true, style: "display:none" });
  folderInput.addEventListener("change", () => loadCopy(folderInput.files));
  document.body.append(folderInput);
  setInterval(() => { if (document.visibilityState === "visible") pollChanges(); }, 4000);
  window.addEventListener("focus", () => pollChanges());
  window.addEventListener("beforeunload", (e) => { if (editor.dirty) { saveEditor(); e.preventDefault(); } });
  window.SupstackApp = { loadVault, HandleFS, MemoryFS, demoVault, vault, board, get graph() { return graph; } };
  startUpdateChecks();
  if (!window.__SN_NO_AUTOSTART) showWelcome().then(autoReopen);
}
