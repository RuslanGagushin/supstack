/* =========================================================
   Board model: which cards the list shows, filtered and limited
   ========================================================= */
import { norm } from "./util.js";
import { matchRank, parseQuery } from "./search.js";

/** The list's cards with the notebooks (cards that have children) first, each group in its own sort order; a notebook is marked `folder`. */
export function notebooksFirst(graph, cards) {
  const folders = [], notes = [];
  for (const c of cards) (graph.childrenOf(c.path).length ? folders : notes).push(c);
  return [...folders.map((c) => ({ ...c, folder: true })), ...notes];
}
export function filterActive(f) { return !!f.query.trim() || f.tags.length > 0; }
/**
 * The cards the list shows: the target's children, notebooks first, or, while searching, every level below it (or the whole vault).
 * `view` is the board's state ({ target, filter }); `cards` says what the vault knows of a card: cmp (sort order),
 * tagsOf(path), textOf(path) (searched), maxCards, and optionally candidatesOf(words) (the notes that may hold
 * them, from core/search.js WordIndex, or null) and rankOf(path) ({ title, headings }, to put the best matches first).
 * `total` counts every level below the target.
 * The query's words must all be in a note's text; +tag and -tag in it require and exclude a tag. The Tags button's
 * tags (filter.tags) let through a note with any of them.
 */
export function computeModel(graph, view, { cmp, tagsOf, textOf, maxCards, candidatesOf = null, rankOf = null }) {
  const f = view.filter;
  const active = filterActive(f);
  // While searching, look through every level below the target (or the whole vault)
  const scopeTarget = active && f.scope === "all" ? null : view.target;
  const all = graph.collect(scopeTarget, active ? 0 : 1, cmp);
  const total = active ? all.cards.length : graph.collect(view.target, 0, cmp).cards.length;
  const q = parseQuery(f.query), tokens = q.words;
  const tagSet = new Set(f.tags);
  const cand = tokens.length && candidatesOf ? candidatesOf(tokens) : null;
  let visible = active ? all.cards.filter((c) => {
    if (cand && !cand.has(c.path)) return false;
    if (tagSet.size || q.include.length || q.exclude.length) {
      let tags = tagsOf(c.path);
      if (tagSet.size && !tags.some((x) => tagSet.has(x))) return false;
      if (q.include.length || q.exclude.length) tags = tags.map(norm); // as the query was: ё is е
      if (!q.include.every((x) => tags.includes(x)) || q.exclude.some((x) => tags.includes(x))) return false;
    }
    if (tokens.length) { const txt = norm(textOf(c.path)); if (!tokens.every((w) => txt.includes(w))) return false; }
    return true;
  }) : notebooksFirst(graph, all.cards);
  // the best matches first: title, then headings, then text; the list's own order within each (sort is stable)
  if (active && tokens.length && rankOf) {
    const rank = new Map(visible.map((c) => { const r = rankOf(c.path); return [c.path, matchRank(tokens, r.title, r.headings)]; }));
    visible = [...visible].sort((a, b) => rank.get(b.path) - rank.get(a.path));
  }
  const truncated = visible.length > maxCards;
  const shown = truncated ? visible.slice(0, maxCards) : visible;
  return { all, total, active, tokens, shown, truncated, cmp };
}
