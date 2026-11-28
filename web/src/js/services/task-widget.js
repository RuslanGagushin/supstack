import { onow } from "../core/org.js";
import { parseTasks, taskEntry } from "../core/tasks.js";
import { widgetDays } from "../core/task-widget.js";
import { IS_ANDROID, vinvoke } from "./native.js";

let source = null, entries = null, sourceText, pending = Promise.resolve(), last = null;

function send(snapshot, fs) {
  // Serialize clears and publications so a late reply from the previous vault
  // cannot restore its titles after a vault switch.
  pending = pending.then(() => {
    if (source === fs) return vinvoke("update_task_widget", { snapshot: snapshot && JSON.stringify(snapshot) });
  }).catch((error) => {
    if (source === fs) {
      last = null;
      sourceText = undefined;
    }
    console.warn("Could not update the Android task widget", error);
  });
  return pending;
}

/** Forget the previous vault's tasks. `pending`: the vault in `fs` is being read now, so a widget that already shows
 *  this same vault keeps its rows until the new list comes (Android drops them for any other vault). */
export function resetTaskWidget(fs = null, { pending = false } = {}) {
  if (!IS_ANDROID) return;
  source = fs?.native ? fs : null;
  entries = null;
  sourceText = undefined;
  last = null;
  return send(source ? { version: 1, root: source.root, ...(pending && { pending: true }) } : null, source);
}

export function refreshTaskWidget() {
  if (!source || !entries) return;
  const today = onow().dn;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `${today}:${zone}`;
  if (last === key) return;
  last = key;
  return send({ version: 1, root: source.root, zone, generated: Date.now(), days: widgetDays(entries, today) }, source);
}

/** Accept only data successfully read or written for the currently loaded vault. */
export function publishTaskWidget(fs, text) {
  if (!source || source !== fs) return;
  if (sourceText === text) return refreshTaskWidget();
  sourceText = text;
  last = null;
  entries = text == null ? null : Array.from(parseTasks(text).records.values(), (record) => taskEntry(record));
  return entries ? refreshTaskWidget() : send({ version: 1, root: fs.root }, fs);
}
