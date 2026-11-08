/* =========================================================
   The vault's folders, the same in every vault (nothing to set up):
     cards/        every note — the board's cards
     attachments/  pasted, dropped and uploaded files
     daily notes/  one note per day, named YYYY-MM-DD (cards too)
   A folder that already exists with other letter case (Cards/) is the same folder.
   ========================================================= */
import { vault } from "./state.js";

export const CARDS = "cards";
export const ATTACHMENTS = "attachments";
export const DAILY = "daily notes";
export const DAILY_FORMAT = "YYYY-MM-DD";

const topFolder = (path) => (path.includes("/") ? path.slice(0, path.indexOf("/")).toLowerCase() : null);
/** Is `path` inside the folder `name` (CARDS, ATTACHMENTS or DAILY)? */
export const inFolder = (path, name) => topFolder(path) === name;
/** The folder's name as it is in this vault (any letter case), else its usual name. */
export function vaultFolder(name) {
  for (const p of vault.allPaths) if (topFolder(p) === name) return p.slice(0, p.indexOf("/"));
  return name;
}
