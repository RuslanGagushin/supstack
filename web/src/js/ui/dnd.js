/* =========================================================
   Drag & drop: cards onto cards, between them and onto the tree
   ========================================================= */
import { baseName } from "../core/util.js";
import { board, graph } from "../services/state.js";
import { linkText } from "../services/vault.js";
import { $, $$, h } from "./dom.js";
import { dropCards } from "./actions.js";

export const dnd = {
  drag: null,
  ghost: null,
  draggable(el, get) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      if (e.target.closest?.("textarea, input")) return;
      const d = get();
      const extra = board.selection.has(d.child) ? [...board.selection].filter((p) => p !== d.child && graph.has(p)).map((p) => ({ child: p, from: $(`.sn-card[data-path="${CSS.escape(p)}"]`)?.dataset.via || null })) : [];
      dnd.drag = [d, ...extra];
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", dnd.drag.map((x) => `[[${linkText(x.child)}]]`).join("\n"));
      dnd.ghost = h("div", { cls: "sn-drag-ghost", text: baseName(d.child) + (extra.length ? ` +${extra.length}` : "") });
      document.body.append(dnd.ghost);
      e.dataTransfer.setDragImage(dnd.ghost, 10, 10);
      requestAnimationFrame(() => el.classList.add("is-dragging"));
      e.stopPropagation();
    });
    el.addEventListener("dragend", () => { el.classList.remove("is-dragging"); dnd.cleanup(); });
  },
  cleanup() { dnd.drag = null; dnd.ghost?.remove(); dnd.ghost = null; $$(".is-drop-inside, .is-drop-before, .is-drop-after").forEach((x) => x.classList.remove("is-drop-inside", "is-drop-before", "is-drop-after")); },
  zone(el, e, zones) {
    if (zones.length === 1) return zones[0];
    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const edge = el.classList.contains("sn-tree-row") ? 0.3 : Math.min(0.25, 28 / r.height);
    if (y < edge) return "before";
    if (y > 1 - edge) return "after";
    return "inside";
  },
  dropTarget(el, get) {
    const valid = (info) => dnd.drag && !dnd.drag.some((d) => d.child === info.path && info.path);
    el.addEventListener("dragover", (e) => {
      if (!dnd.drag) return;
      const info = get();
      if (!valid(info)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.ctrlKey || e.altKey || e.metaKey ? "copy" : "move";
      const z = dnd.zone(el, e, info.zones || ["before", "inside", "after"]);
      el.classList.toggle("is-drop-inside", z === "inside");
      el.classList.toggle("is-drop-before", z === "before");
      el.classList.toggle("is-drop-after", z === "after");
    });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("is-drop-inside", "is-drop-before", "is-drop-after"); });
    el.addEventListener("drop", (e) => {
      if (!dnd.drag) return;
      const info = get();
      if (!valid(info)) return;
      e.preventDefault();
      e.stopPropagation();
      const z = dnd.zone(el, e, info.zones || ["before", "inside", "after"]);
      const items = dnd.drag;
      const add = e.ctrlKey || e.altKey || e.metaKey;
      dnd.cleanup();
      if (info.root) dropCards(items, null, true, null);
      else if (z === "inside") dropCards(items, info.path, !add, null);
      else dropCards(items, info.parent ?? null, !add, { path: info.path, pos: z });
    });
  },
};

