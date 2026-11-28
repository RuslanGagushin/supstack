import { onow } from "../core/org.js";
import { parseTasks, taskEntry } from "../core/tasks.js";
import { widgetDays } from "../core/task-widget.js";
import { on } from "./events.js";
import { IS_ANDROID, vinvoke } from "./native.js";
import { vault } from "./state.js";

/** The snapshot's format; Android shows nothing from another version until the app sends this one. */
const VERSION = 2;
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
  return send(source ? { version: VERSION, root: source.root, ...(pending && { pending: true }) } : null, source);
}

/** The name of the note each task belongs to, while the notes in memory are this vault's. */
function noteNames() {
  const names = new Map();
  if (vault.fs !== source) return names;
  for (const note of vault.notes.values()) {
    const id = note.fm?.id;
    if (id != null && id !== "" && !names.has(String(id))) names.set(String(id), note.name);
  }
  return names;
}

export function refreshTaskWidget() {
  if (!source || !entries) return;
  const today = onow().dn;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const names = noteNames();
  const days = widgetDays(entries, today, (e) => (e.noteId == null ? null : names.get(String(e.noteId)) ?? null));
  // the same day, zone and rows as last sent (a focus, or a note saved without a rename): nothing to send
  const key = `${today}:${zone}:${JSON.stringify(days)}`;
  if (last === key) return;
  last = key;
  return send({ version: VERSION, root: source.root, zone, generated: Date.now(), days }, source);
}

/** Accept only data successfully read or written for the currently loaded vault. */
export function publishTaskWidget(fs, text) {
  if (!source || source !== fs) return;
  if (sourceText === text) return refreshTaskWidget();
  sourceText = text;
  last = null;
  entries = text == null ? null : Array.from(parseTasks(text).records.values(), (record) => taskEntry(record));
  return entries ? refreshTaskWidget() : send({ version: VERSION, root: fs.root }, fs);
}

// a note renamed, added or deleted changes the names the rows show
if (IS_ANDROID) for (const type of ["written", "changed", "opened"]) on(type, () => { refreshTaskWidget(); });
