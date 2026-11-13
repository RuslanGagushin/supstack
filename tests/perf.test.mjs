// Large vaults (spec §4.1): the made-up vault from scripts/big-vault.mjs, and how the page copes with it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bigVault } from "../scripts/big-vault.mjs";
import { openVault, ev } from "./harness.mjs";

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
