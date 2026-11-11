/* =========================================================
   App state: the open vault, the card settings (S), the page's own settings (UI), the graph, and the
   board, tree and editor state. Shared by reference; S and the graph change only through resetSettings / setGraph.
   ========================================================= */
import { HierarchyGraph } from "../core/graph.js";
import { lsGet, lsSet } from "./storage.js";

export const DEFAULTS = {
  pinned: [], savedViews: [], language: "auto", defaultDepth: 1, defaultSort: "manual", defaultGrouped: false,
  outlineSort: "manual", maxCards: 1000,
};
export const UI = Object.assign({ theme: "auto", sideW: 280, editorW: 560, listW: 380, sideOpen: true, lang: "auto" }, lsGet("sn-ui", {}));
delete UI.style; delete UI.font; delete UI.writeFont; // retired settings
export const saveUI = () => lsSet("sn-ui", UI);

export const vault = {
  fs: null,
  notes: new Map(), // path -> note
  byName: new Map(), // lower basename -> [md paths]
  files: new Map(), // lower filename -> [paths] (attachments)
  allPaths: new Set(),
  sizes: new Map(), // path -> bytes (for the sync size limit)
  mtimes: new Map(), // attachment path -> last modified (for the Files view)
};
/** The frontmatter property that lists a card's parents. */
export const PARENTS_FIELD = "parents";
export const S = { ...DEFAULTS }; // the vault's settings (services/vault.js keeps them in .supstack/settings.json)
/** Settings of a newly opened vault: the defaults, then `saved`. */
// the board's other layouts and its cards' look are gone; a vault's settings file that still has them loses them on the next save
const RETIRED_SETTINGS = ["defaultLayout", "cardFace", "previewLength", "cardMaxHeight"];
export function resetSettings(saved) {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, DEFAULTS, saved);
  for (const k of RETIRED_SETTINGS) delete S[k];
}
export let graph = new HierarchyGraph();
export const setGraph = (g) => { graph = g; };
export const board = {
  target: null, depth: 1, sort: "manual", grouped: false,
  filter: { query: "", tags: [] }, searchOpen: false,
  history: [], selection: new Set(), selectMode: false, rendered: 60,
};
export const tree = { expanded: new Set() };
// base: { path, raw } — the note's text the editor's text started from; when the note on disk differs at save time,
// it changed outside the editor while there was unsaved typing (ui/editor.js saveEditor)
export const editor = { path: null, mode: "edit", dirty: false, saving: false, wide: true, propsCollapsed: true, base: null };
export const undoStack = [];

