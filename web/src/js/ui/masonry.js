/* =========================================================
   Masonry: cards in columns of even height
   ========================================================= */
import { board } from "../services/state.js";
import { h } from "./dom.js";

export class Masonry {
  constructor(parent) { this.el = h("div", { cls: "sn-masonry" }); parent.append(this.el); this.items = []; this.colCount = 0; }
  columnCount() {
    if (board.layout === "list") return 1;
    const w = this.el.clientWidth;
    if (!w) return 1;
    return Math.max(1, Math.min(5, Math.floor((w + 12) / (280 + 12))));
  }
  add(el) { this.items.push(el); if (!this.colCount) this.relayout(true); else this.place(el); }
  relayout(force) {
    const n = this.columnCount();
    if (!force && n === this.colCount) return;
    this.colCount = n;
    this.el.replaceChildren();
    this.el.style.setProperty("--sn-cols", String(n));
    for (let i = 0; i < n; i++) this.el.append(h("div", { cls: "sn-col" }));
    for (const it of this.items) this.place(it);
  }
  place(item) {
    const cols = [...this.el.children];
    let best = cols[0];
    for (const c of cols) if (c.offsetHeight < best.offsetHeight - 1) best = c;
    best.append(item);
  }
}
export const masonries = []; // the board's live layouts; views empty it (length = 0) before they render
export const boardResize = new ResizeObserver(() => { for (const m of masonries) m.relayout(false); });

