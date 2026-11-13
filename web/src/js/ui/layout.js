/* =========================================================
   Windows between a phone and a wide desktop (spec UI-1, UI-2, UI-3). A note open beside the list keeps at least
   500px (its text about 400px):
   - under MID wide, opening a note folds the sidebar away; opened again by hand, it lies over the page as a drawer,
     and stays open until the window changes width. Folding by the layout is not saved: a wider window gets it back.
   - under STACK wide, the note covers the list, with "‹ its notebook" to go back, as on a phone.
   - wider than MID, the list gives way (down to 260px) before the note goes under 500px (app.css).
   Phones (PHONE and under) keep their own layout.
   ========================================================= */
import { UI } from "../services/state.js";
import { $ } from "./dom.js";

export const PHONE = 820, STACK = 960, MID = 1180;
let foldedByLayout = false; // the sidebar is closed because the window is narrow, not because it was closed
let openedAt = null; // the window width at which it was opened by hand while the layout had folded it

const app = () => $("#app");
const noteBeside = (a) => a.classList.contains("editor-open") && !a.classList.contains("focus-mode");

/** Set the layout's classes for the window as it is, and fold or unfold the sidebar. */
export function applyLayout() {
  const a = app();
  if (!a) return;
  const w = innerWidth;
  a.classList.toggle("is-mid", w > PHONE && w < MID);
  a.classList.toggle("is-stacked", w > PHONE && w < STACK);
  if (w <= PHONE) return;
  if (openedAt != null && openedAt !== w) openedAt = null;
  const crowded = w < MID && noteBeside(a);
  if (crowded && !a.classList.contains("side-closed") && openedAt == null) { a.classList.add("side-closed"); foldedByLayout = true; }
  else if (!crowded && foldedByLayout) { foldedByLayout = false; a.classList.toggle("side-closed", !UI.sideOpen); }
}
/** The sidebar was opened or closed by hand (shell.js setSide). */
export function sideSetByHand(open) {
  foldedByLayout = false;
  openedAt = open && innerWidth < MID ? innerWidth : null;
}
/** The sidebar lies over the page (a drawer), so closing it is the layout's business, not a setting to keep. */
export const sideIsDrawer = () => { const a = app(); return !!a && innerWidth > PHONE && a.classList.contains("is-mid") && noteBeside(a); };
/** Close the drawer without changing the saved setting: the next wide window shows the sidebar again. */
export function foldDrawer() {
  app()?.classList.add("side-closed");
  foldedByLayout = true;
  openedAt = null;
}

let pending = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(applyLayout); });
