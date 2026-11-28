import { tt } from "../core/i18n.js";
import { IS_ANDROID, vinvoke } from "../services/native.js";
import { vault } from "../services/state.js";
import { refreshTaskWidget } from "../services/task-widget.js";
import { openWidgetAgenda, orgCapture } from "./agenda.js";
import { closeEditor } from "./editor.js";
import { echo } from "./ui.js";
import { pickVault } from "./welcome.js";

/** Start after automatic vault reopening, so cold and warm taps use the same handler. */
export function startTaskWidget() {
  if (!IS_ANDROID) return;
  let queue = Promise.resolve();
  function poll() {
    queue = queue.then(async () => {
      refreshTaskWidget();
      const target = await vinvoke("take_task_widget_action", {});
      if (!target) return;
      if (!vault.fs?.native && target.action === "add") await pickVault();
      if (!vault.fs) return;
      if (target.action === "add") {
        if (vault.fs.native) orgCapture();
        return;
      }
      const wrongVault = target.action === "task" && target.root !== vault.fs.root;
      closeEditor();
      openWidgetAgenda(wrongVault ? null : target.id);
      if (wrongVault) echo(tt("widgetOtherVault"));
    }).catch((error) => console.warn("Could not open the Android task widget action", error));
  }
  window.addEventListener("supstack-task-widget", poll);
  window.addEventListener("focus", poll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
  poll();
}
