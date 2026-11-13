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
export const LIMITS = { open: 5000, reopen: 5000, poll: 300, search: 1500, render: 1500 };

describe("timings on 10 000 notes (PERF-2)", () => {
  test("opening, an idle poll, a two-word search and the first list stay under their limits", async () => {
    await openNativeApp({ notes: bigVault(10000), expose: true });
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (vault.notes.size >= 10000) { clearInterval(t); r(); } }, 50); }));
    const ms = await ev(async () => {
      const t = async (fn) => { const a = performance.now(); await fn(); return Math.round(performance.now() - a); };
      // opening without the index cache, then with it (PERF-5)
      await dropIndexCache(vault.fs);
      const open = await t(() => loadVault(new NativeFS("/vault", "Vault")));
      const cold = vault.stats.parsed;
      await flushIndexCache(vault.notes, vault.sizes);
      const reopen = await t(() => loadVault(new NativeFS("/vault", "Vault")));
      const warm = vault.stats.cached;
      const poll = await t(() => pollChanges());
      Object.assign(board.filter, { query: "amber river", tags: [], scope: "all" });
      let found = 0;
      const search = await t(() => { const m = boardModel(); found = m.truncated ? m.shown.length + "+" : m.shown.length; });
      Object.assign(board.filter, { query: "", tags: [], scope: "here" });
      // the list of the notebook that holds the most notes
      const big = [...vault.notes.keys()].sort((a, b) => graph.childrenOf(b).length - graph.childrenOf(a).length)[0];
      const render = await t(() => { setTarget(big); void document.querySelector("#board").offsetHeight; });
      return { open, cold, reopen, warm, poll, search, render, found, rows: document.querySelectorAll("#board .sn-row").length };
    });
    console.log(`10 000 notes: open ${ms.open} ms · reopen from the cache ${ms.reopen} ms · idle poll ${ms.poll} ms · search ${ms.search} ms (${ms.found} found) · list ${ms.render} ms (${ms.rows} rows)`);
    assert.ok(parseInt(ms.found) > 0 && ms.rows > 0, JSON.stringify(ms));
    assert.ok(ms.cold === 10000 && ms.warm === 10000, `parsed ${ms.cold} the first time, ${ms.warm} from the cache the second`);
    for (const k of Object.keys(LIMITS)) assert.ok(ms[k] < LIMITS[k], `${k}: ${ms[k]} ms, limit ${LIMITS[k]} ms`);
  });
});

describe("polling for outside changes (PERF-4)", () => {
  test("an idle poll reads no file; a changed file is the only one read", async () => {
    const notes = bigVault(1000);
    await openNativeApp({ notes, expose: true });
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (vault.notes.size >= 1000) { clearInterval(t); r(); } }, 20); }));
    const reads = () => ev(async () => { window.__invokes.length = 0; await pollChanges(); return window.__invokes.filter(([c]) => c === "plugin:vault|read").map(([, a]) => a.path); });
    assert.deepEqual(await reads(), [], "nothing changed, nothing read");
    const path = Object.keys(notes).find((p) => p.startsWith("cards/"));
    await ev((p) => { const f = window.__vaultFiles[p]; window.__vaultFiles[p] = { text: f.text + "\nAdded elsewhere.\n", mtime: f.mtime + 5000 }; }, path);
    assert.deepEqual(await reads(), [path]);
    assert.match(await ev((p) => vault.notes.get(p).raw, path), /Added elsewhere\.\n$/);
    assert.deepEqual(await reads(), [], "read once, not again");
  });
});

describe("the index cache (PERF-5, PERF-6)", () => {
  const N = 1000;
  const open = async () => {
    await openNativeApp({ notes: bigVault(N), expose: true });
    await ev((n) => new Promise((r) => { const t = setInterval(() => { if (vault.notes.size >= n) { clearInterval(t); r(); } }, 20); }), N);
  };
  /** Write the cache, open the vault again, and say what was parsed, taken from the cache and read from the disk. */
  const reopen = () => ev(async () => {
    await flushIndexCache(vault.notes, vault.sizes);
    window.__invokes.length = 0;
    await loadVault(new NativeFS("/vault", "Vault"));
    const reads = window.__invokes.filter(([c, a]) => c === "plugin:vault|read" && a.path.endsWith(".md")).length;
    return { ...vault.stats, reads };
  });
  const snapshot = () => ev(() => [...vault.notes.values()].map((n) => [n.path, n.raw, n.fm, n.fmError, n.tags, n.links, n.mtime, n.ctime, n.fmRaw, n.body]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  test("reopening a vault that did not change parses and reads no note, and gives the same notes", async () => {
    await open();
    assert.deepEqual(await ev(() => vault.stats), { parsed: N, cached: 0 }, "the first time, every note is parsed");
    const before = await snapshot();
    assert.deepEqual(await reopen(), { parsed: 0, cached: N, reads: 0 });
    assert.deepEqual(await snapshot(), before);
  });

  test("only the notes that changed, appeared or were saved since are parsed again; a deleted one leaves the cache", async () => {
    await open();
    const [a, b] = await ev(() => [...vault.notes.keys()].filter((p) => p.startsWith("cards/")).slice(0, 2));
    await ev(([a, b]) => {
      const f = window.__vaultFiles[a];
      window.__vaultFiles[a] = { text: f.text + "\nChanged elsewhere.\n", mtime: f.mtime + 1000 };
      window.__vaultFiles["cards/New one.md"] = { text: "Brand new #fresh\n", mtime: 5 };
      delete window.__vaultFiles[b];
    }, [a, b]);
    assert.deepEqual(await reopen(), { parsed: 2, cached: N - 2, reads: 2 });
    assert.match(await ev((p) => vault.notes.get(p).raw, a), /Changed elsewhere/);
    assert.deepEqual(await ev(() => vault.notes.get("cards/New one.md").tags), ["#fresh"]);
    // a note saved in the app is cached with what it was saved as, in bytes
    await ev((p) => writeRaw(p, vault.notes.get(p).raw + "Ünïcode ✓\n"), a);
    assert.deepEqual(await reopen(), { parsed: 0, cached: N, reads: 0 }); // N: one note gone, one new
    assert.match(await ev((p) => vault.notes.get(p).raw, a), /Ünïcode ✓\n$/);
    assert.equal(await ev((p) => vault.notes.has(p), b), false);
  });

  test("a cache from another version, or a damaged entry, is not used: those notes are read and parsed again", async () => {
    await open();
    await ev(() => flushIndexCache(vault.notes, vault.sizes));
    const db = () => new Promise((r) => { const q = indexedDB.open("supstack-index", 1); q.onsuccess = () => r(q.result); });
    const p = await ev(() => [...vault.notes.keys()].find((x) => x.startsWith("cards/")));
    // one entry damaged in three ways: the text is not text, the tags are not a list, the frontmatter is gone
    await ev(async ([p, open]) => {
      const d = await eval(open)();
      const tx = d.transaction("notes", "readwrite");
      const st = tx.objectStore("notes");
      const key = cacheKeyOf(vault.fs) + "\u0000" + p;
      await new Promise((r) => { st.get(key).onsuccess = (e) => { st.put({ ...e.target.result, raw: 42, tags: "x", fm: null }, key); }; tx.oncomplete = r; });
    }, [p, db.toString()]);
    assert.deepEqual(await reopen(), { parsed: 1, cached: N - 1, reads: 1 });
    assert.equal(await ev((p) => typeof vault.notes.get(p).raw, p), "string");
    // a cache written by another version of the app is dropped as a whole
    await ev(async (open) => {
      const d = await eval(open)();
      const tx = d.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ version: CACHE_VERSION + 1 }, cacheKeyOf(vault.fs));
      await new Promise((r) => { tx.oncomplete = r; });
    }, db.toString());
    const r = await ev(async () => { window.__invokes.length = 0; await loadVault(new NativeFS("/vault", "Vault")); return vault.stats; });
    assert.deepEqual(r, { parsed: N, cached: 0 });
    assert.deepEqual(await reopen(), { parsed: 0, cached: N, reads: 0 }, "and built again");
  });
});
