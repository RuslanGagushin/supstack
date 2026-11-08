/* =========================================================
   Events: how services/ tell the page what happened without knowing the page.
   Services emit, ui/ modules subscribe when they load. Handlers run right away, in the order they
   subscribed; one may return a promise, and emit's promise waits for all of them.

     notice   (text, opts)   a message for the user (opts as ui/ui.js notice takes them)
     flush    (path?)        save the editor first, if it has unsaved text (for this note, or any)
     written  (path, opts)   a note was written; opts.silentEditor: the editor already shows this text
     changed  (opts)         notes changed: redraw; opts.disk: they changed on disk, outside the page
     sync                    Git sync's state changed
     sync-setup              a sync was asked for, but there is no remote yet
     update                  a newer version of the app is available
   ========================================================= */
export const handlers = new Map();
/** Subscribe to `type`; returns a function that unsubscribes. */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}
export function emit(type, ...args) {
  return Promise.all([...(handlers.get(type) ?? [])].map((fn) => fn(...args)));
}
