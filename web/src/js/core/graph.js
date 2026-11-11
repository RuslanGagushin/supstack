/* =========================================================
   Hierarchy graph: cards and their parents (a card can have several), children, roots and backlinks
   ========================================================= */
const INFINITE_DEPTH_CAP = 64;
export class HierarchyGraph {
  constructor() { this.parents = new Map(); this.children = new Map(); this.unresolved = new Map(); this.linksIn = new Map(); this.childOrder = new Map(); this.nodes = new Set(); }
  has(p) { return this.nodes.has(p); }
  setNode(path, parents, unresolved, links, childOrder) {
    this.nodes.add(path);
    if (childOrder.length) this.childOrder.set(path, childOrder);
    const ps = new Set(parents.filter((p) => p !== path));
    if (ps.size) this.parents.set(path, ps);
    for (const p of ps) { let s = this.children.get(p); if (!s) this.children.set(p, (s = new Set())); s.add(path); }
    if (unresolved.length) this.unresolved.set(path, unresolved);
    for (const l of new Set(links)) { if (l === path) continue; let s = this.linksIn.get(l); if (!s) this.linksIn.set(l, (s = new Set())); s.add(path); }
  }
  parentsOf(p) { return [...(this.parents.get(p) ?? [])]; }
  childrenOf(p) { return [...(this.children.get(p) ?? [])].filter((c) => this.nodes.has(c)); }
  unresolvedParentsOf(p) { return this.unresolved.get(p) ?? []; }
  positionIn(parent, child) { return this.childOrder.get(parent)?.indexOf(child) ?? -1; }
  backlinksOf(p) { return [...(this.linksIn.get(p) ?? [])].filter((x) => this.nodes.has(x)); }
  roots() { return [...this.nodes].filter((n) => !this.parentsOf(n).some((p) => this.nodes.has(p))); }
  sortedChildren(parent, cmp) { return (parent ? this.childrenOf(parent) : this.roots()).sort((a, b) => cmp(a, b, parent)); }
  collect(target, depth, cmp, maxCards = Infinity) {
    const limit = depth <= 0 ? INFINITE_DEPTH_CAP : depth;
    const seen = new Set();
    if (target) seen.add(target);
    const cards = [];
    let skippedRepeats = 0, truncated = false;
    const walk = (paths, level, via) => {
      for (const p of paths) {
        if (truncated) return;
        if (seen.has(p)) { skippedRepeats++; continue; }
        if (cards.length >= maxCards) { truncated = true; return; }
        seen.add(p);
        cards.push({ path: p, depth: level, via });
        if (level < limit) walk(this.sortedChildren(p, cmp), level + 1, p);
      }
    };
    walk(this.sortedChildren(target, cmp), 1, target);
    return { cards, skippedRepeats, truncated };
  }
  ancestry(path, cmp) {
    const chain = [];
    const seen = new Set([path]);
    let cur = path;
    for (;;) {
      const ps = this.parentsOf(cur).filter((p) => this.nodes.has(p)).sort((a, b) => cmp(a, b));
      const next = ps.find((p) => !seen.has(p));
      if (!next) break;
      chain.unshift(next);
      seen.add(next);
      cur = next;
    }
    return chain;
  }
  isDescendant(from, to) {
    const stack = [from];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const c of this.children.get(cur) ?? []) stack.push(c);
    }
    return false;
  }
}
export function reorderBlock(siblings, moved, anchor, pos) {
  const set = new Set(moved);
  const list = siblings.filter((s) => !set.has(s));
  const i = anchor && !set.has(anchor) ? list.indexOf(anchor) : -1;
  if (i < 0) list.push(...moved);
  else list.splice(pos === "before" ? i : i + 1, 0, ...moved);
  return list;
}

