/* =========================================================
   The vault's tasks: core/org.js applied to the notes.
   ========================================================= */
import { orgCache, orgParse } from "../core/org.js";
import { vault } from "./state.js";

/** The tasks and events in a note. */
export const orgEntries = (note) => orgParse(note);
export function orgAll() {
  const out = [];
  for (const n of vault.notes.values()) { if (n.raw.length > 400000) continue; out.push(...orgEntries(n)); }
  for (const p of orgCache.keys()) if (!vault.notes.has(p)) orgCache.delete(p);
  return out;
}
/** Card footer: how many of the note's tasks are done (cancelled and forwarded ones don't count). */
export function cardTaskProgress(path) {
  const n = vault.notes.get(path);
  if (!n) return null;
  const es = orgEntries(n).filter((x) => x.isTodo && (x.cls !== "cancel" && x.cls !== "fwd"));
  return es.length ? { done: es.filter((x) => x.done).length, n: es.length } : null;
}
