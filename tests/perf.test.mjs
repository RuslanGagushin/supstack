// Large vaults (spec §4.1): the made-up vault from scripts/big-vault.mjs, and how the page copes with it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bigVault } from "../scripts/big-vault.mjs";
import { openNativeApp, openVault, ev } from "./harness.mjs";

describe("the big vault (PERF-1)", () => {
  test("the generator makes the asked number of notes, the same ones for the same seed", () => {
    for (const n of [1000, 5000, 10000]) assert.equal(Object.keys(bigVault(n)).length, n);
    assert.deepEqual(bigVault(300), bigVault(300));
    assert.notDeepEqual(bigVault(300, { seed: 2 }), bigVault(300));
  });

  test("it opens in the page with notebooks four levels deep, tasks, tags and links", async () => {
    await openVault({ demo: false, notes: bigVault(1000) });
    const r = await ev(() => {
      const depth = (p, seen = new Set()) => { if (seen.has(p)) return 0; seen.add(p); const ps = graph.parentsOf(p); return ps.length ? 1 + Math.max(...ps.map((x) => depth(x, seen))) : 0; };
      const notes = [...vault.notes.values()];
      return {
        notes: notes.length,
        notebooks: notes.filter((n) => graph.childrenOf(n.path).length).length,
        deepest: Math.max(...notes.map((n) => depth(n.path))),
        tasks: notes.filter((n) => /^- \[.\] /m.test(n.body)).length,
        dated: notes.filter((n) => /(SCHEDULED|DEADLINE): </.test(n.body)).length,
        tagged: notes.filter((n) => n.tags.length).length,
        linked: notes.filter((n) => graph.backlinksOf(n.path).length).length,
        daily: notes.filter((n) => n.path.startsWith("daily notes/")).length,
        unresolved: notes.filter((n) => graph.unresolvedParentsOf(n.path).length).length,
      };
    });
    assert.equal(r.notes, 1000);
    assert.ok(r.notebooks >= 40, `notebooks: ${r.notebooks}`);
    assert.equal(r.deepest, 4, "notes sit up to four notebooks deep");
    assert.ok(r.tasks > 300 && r.dated > 100, JSON.stringify(r));
    assert.ok(r.tagged > 400 && r.linked > 200, JSON.stringify(r));
    assert.equal(r.daily, 50);
    assert.equal(r.unresolved, 0, "every parent exists");
  });
});

/**
 * Four timings on 10 000 notes, printed with every run (spec PERF-2). The page runs as the app does (NativeFS over a
 * plugin answered in memory), so the numbers are the page's own work: parsing, the hierarchy, the list; not the disk.
 * A limit fails the test only when something got several times slower; the numbers in docs/specification.md are from the first run.
 */
export const LIMITS = { open: 5000, poll: 300, search: 1500, render: 1500 };

describe("timings on 10 000 notes (PERF-2)", () => {
  test("opening, an idle poll, a two-word search and the first list stay under their limits", async () => {
    await openNativeApp({ notes: bigVault(10000), expose: true });
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (vault.notes.size >= 10000) { clearInterval(t); r(); } }, 50); }));
    const ms = await ev(async () => {
      const t = async (fn) => { const a = performance.now(); await fn(); return Math.round(performance.now() - a); };
      const open = await t(() => loadVault(new NativeFS("/vault", "Vault")));
      const poll = await t(() => pollChanges());
      Object.assign(board.filter, { query: "amber river", tags: [], scope: "all" });
      let found = 0;
      const search = await t(() => { const m = boardModel(); found = m.truncated ? m.shown.length + "+" : m.shown.length; });
      Object.assign(board.filter, { query: "", tags: [], scope: "here" });
      // the list of the notebook that holds the most notes
      const big = [...vault.notes.keys()].sort((a, b) => graph.childrenOf(b).length - graph.childrenOf(a).length)[0];
      const render = await t(() => { setTarget(big); void document.querySelector("#board").offsetHeight; });
      return { open, poll, search, render, found, rows: document.querySelectorAll("#board .sn-row").length };
    });
    console.log(`10 000 notes: open ${ms.open} ms · idle poll ${ms.poll} ms · search ${ms.search} ms (${ms.found} found) · list ${ms.render} ms (${ms.rows} rows)`);
    assert.ok(parseInt(ms.found) > 0 && ms.rows > 0, JSON.stringify(ms));
    for (const k of Object.keys(LIMITS)) assert.ok(ms[k] < LIMITS[k], `${k}: ${ms[k]} ms, limit ${LIMITS[k]} ms`);
  });
});
