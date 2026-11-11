/* =========================================================
   Board model: which cards the list shows, filtered and limited
   ========================================================= */
import { norm } from "./util.js";

export function filterActive(f) { return !!f.query.trim() || f.tags.length > 0; }
/**
 * The cards the list shows: the target's children, or, while searching, every level below it (or the whole vault).
 * `view` is the board's state ({ target, filter }); `cards` says what the vault knows of a card: cmp (sort order),
 * tagsOf(path), textOf(path) (searched), maxCards. `total` counts every level below the target.
 */
export function computeModel(graph, view, { cmp, tagsOf, textOf, maxCards }) {
  const f = view.filter;
  const active = filterActive(f);
  // While searching, look through every level below the target (or the whole vault)
  const scopeTarget = active && f.scope === "all" ? null : view.target;
  const all = graph.collect(scopeTarget, active ? 0 : 1, cmp);
  const total = active ? all.cards.length : graph.collect(view.target, 0, cmp).cards.length;
  const tokens = norm(f.query).split(/\s+/).filter(Boolean);
  const tagSet = new Set(f.tags);
  const visible = active ? all.cards.filter((c) => {
    if (tagSet.size && !tagsOf(c.path).some((x) => tagSet.has(x))) return false;
    if (tokens.length) { const txt = norm(textOf(c.path)); if (!tokens.every((w) => txt.includes(w))) return false; }
    return true;
  }) : all.cards;
  const truncated = visible.length > maxCards;
  const shown = truncated ? visible.slice(0, maxCards) : visible;
  return { all, total, active, tokens, shown, truncated, cmp };
}
