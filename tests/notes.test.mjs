// Notes: frontmatter, tags, links, link resolution, templates, the card hierarchy and sorting.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";

before(() => openVault({
  demo: false,
  notes: {
    "cards/Projects/Home.md": "---\ntags: [house, \"#garden\"]\n---\nBody with #inline/sub and `#notatag` and #123\n%%#hidden%%\n```\n#code\n```\n[[Shop]] [[Projects/Plans|plans]] ![[Shop#Section]] [md](Other%20Note.md) [web](https://x.com/a.md)\n",
    "cards/Projects/Shop.md": "shop in projects\n",
    "cards/Archive/Shop.md": "shop in archive\n",
    "cards/Projects/Plans.md": "",
    "cards/Other Note.md": "---\nbroken: [\n---\ntext\n",
    "Att/pic.png": "png",
  },
}));

describe("frontmatter and body", () => {
  test("splitNote separates the frontmatter block", async () => {
    assert.deepEqual(await ev(() => splitNote("---\na: 1\n---\nbody")), { fm: "---\na: 1\n---\n", body: "body" });
    assert.deepEqual(await ev(() => splitNote("no frontmatter\n---\n")), { fm: "", body: "no frontmatter\n---\n" });
    assert.deepEqual(await ev(() => splitNote("---\r\na: 1\r\n---\r\nwin")), { fm: "---\r\na: 1\r\n---\r\n", body: "win" });
  });

  test("parseYaml keeps strings as strings and ignores non-objects", async () => {
    assert.deepEqual(await ev(() => parseYaml("date: 2026-01-02\nn: 5\nyes: yes")), { date: "2026-01-02", n: 5, yes: "yes" });
    assert.deepEqual(await ev(() => parseYaml("- a\n- b")), {});
    assert.deepEqual(await ev(() => parseYaml("")), {});
  });

  test("dumpYaml writes links quoted and on one line", async () => {
    assert.equal(await ev(() => dumpYaml({ parents: ["[[A]]"], title: "x: y" })), 'parents:\n  - "[[A]]"\ntitle: "x: y"\n');
  });

  test("a broken frontmatter is reported, not thrown", async () => {
    const n = await ev(() => { const n = vault.notes.get("cards/Other Note.md"); return { err: !!n.fmError, fm: n.fm, body: n.body }; });
    assert.deepEqual(n, { err: true, fm: {}, body: "text\n" });
  });

  test("tags from the frontmatter and the text, not from code, comments or numbers", async () => {
    assert.deepEqual(await ev(() => vault.notes.get("cards/Projects/Home.md").tags), ["#house", "#garden", "#inline/sub"]);
    assert.deepEqual(await ev(() => noteTags({ tag: "a, b c" }, "")), ["#a", "#b", "#c"]);
  });

  test("links: wiki links and .md markdown links, not web addresses or code", async () => {
    assert.deepEqual(await ev(() => vault.notes.get("cards/Projects/Home.md").links), ["Shop", "Projects/Plans", "Shop", "Other Note.md"]);
  });

  test("extractLinkpath strips embeds, aliases, headings and decodes markdown links", async () => {
    const r = await ev(() => ["[[A|b]]", "![[A#h]]", "[x](My%20Note.md)", "  plain  ", "", "[[]]", 5].map(extractLinkpath));
    assert.deepEqual(r, ["A", "A", "My Note.md", "plain", null, "[[]]", null]);
  });

  test("parentLinkpaths reads every YAML shape of a link list", async () => {
    // YAML turns an unquoted [[A]] into nested arrays
    assert.deepEqual(await ev(() => parentLinkpaths(parseYaml("p: [[A]]").p)), ["A"]);
    assert.deepEqual(await ev(() => parentLinkpaths(["[[A]]", "[[B|x]]", "[[A]]"])), ["A", "B"]);
    assert.deepEqual(await ev(() => parentLinkpaths("[[C]]")), ["C"]);
    assert.deepEqual(await ev(() => parentLinkpaths(null)), []);
    assert.deepEqual(await ev(() => toStringList([["A"], "[[B]]", 3])), ["[[A]]", "[[B]]"]);
  });
});

describe("link resolution", () => {
  test("a name resolves in the same folder first, then the shortest path", async () => {
    assert.equal(await ev(() => resolveLink("Shop", "cards/Projects/Home.md")), "cards/Projects/Shop.md");
    assert.equal(await ev(() => resolveLink("Shop", "cards/Archive/x.md")), "cards/Archive/Shop.md");
    assert.equal(await ev(() => resolveLink("archive/shop", "cards/Projects/Home.md")), "cards/Archive/Shop.md");
    assert.equal(await ev(() => resolveLink("cards/SHOP.md", "cards/Archive/x.md")), "cards/Archive/Shop.md");
    assert.equal(await ev(() => resolveLink("Missing", "")), null);
  });

  test("attachments resolve by exact path, relative path or name", async () => {
    assert.equal(await ev(() => resolveAttachment("Att/pic.png", "")), "Att/pic.png");
    assert.equal(await ev(() => resolveAttachment("pic.png", "cards/Projects/Home.md")), "Att/pic.png");
    assert.equal(await ev(() => resolveAttachment("PIC.PNG", "")), "Att/pic.png");
    assert.equal(await ev(() => resolveFileLink("Shop", "")), null, "a note name is not a file link");
  });

  test("linkText uses the full path only when the name is ambiguous", async () => {
    assert.equal(await ev(() => linkText("cards/Projects/Shop.md")), "cards/Projects/Shop");
    assert.equal(await ev(() => linkText("cards/Projects/Plans.md")), "Plans");
  });
});

describe("helpers", () => {
  test("sanitizeTitle drops characters files can't have", async () => {
    assert.equal(await ev(() => sanitizeTitle("  a/b:c*?  [x] #1  ")), "a b c x 1");
  });

  test("fillTemplate fills title, date and time", async () => {
    const r = await ev(() => fillTemplate("{{title}} {{date}} {{time}} {{ date:YYYY/MM }} {{other}}", "T", new Date(2026, 0, 5, 9, 7)));
    assert.equal(r, "T 2026-01-05 09:07 2026/01 {{other}}");
  });

  test("composeBody joins template and typed text", async () => {
    assert.deepEqual(await ev(() => [composeBody("\n\ntpl\n\n", "typed"), composeBody("", " x "), composeBody("tpl", ""), composeBody("", "")]),
      ["tpl\n\ntyped\n", "x\n", "tpl\n", ""]);
  });

  test("formatMoment knows Moment's tokens and literals", async () => {
    const r = await ev(() => formatMoment(new Date(2026, 9, 29, 14, 5, 9), "YYYY-MM-DD ddd HH:mm:ss [W]W Do MMMM h A DDDD Q"));
    assert.equal(r, "2026-10-29 Thu 14:05:09 W44 29th October 2 PM 302 4");
  });

  test("fuzzyScore prefers word starts and rejects missing letters", async () => {
    const [start, word, inner, scattered, none] = await ev(() => [fuzzyScore("rom", "Roman Empire"), fuzzyScore("emp", "Roman Empire"), fuzzyScore("man", "Roman Empire"), fuzzyScore("rme", "Roman Empire"), fuzzyScore("xyz", "Roman Empire")]);
    assert.ok(start > word && word > inner && inner > scattered && scattered > 0);
    assert.equal(none, 0);
  });

  test("pluralIndex and t() pick English and Russian plural forms", async () => {
    assert.deepEqual(await ev(() => [1, 2, 5].map((n) => t("cardsCount", { n }))), ["1 card", "2 cards", "5 cards"]);
    assert.deepEqual(await ev(() => { const was = LANG; setLang("ru"); const r = [1, 3, 5, 11, 21, 22].map(pluralIndex); setLang(was); return r; }), [0, 1, 2, 2, 0, 1]);
  });
});

describe("hierarchy", () => {

  test("children, roots, depth and repeats", async () => {
    const r = await ev(() => {
      const g = new HierarchyGraph();
      g.setNode("A", [], [], [], []); g.setNode("B", ["A"], [], [], []); g.setNode("C", ["B"], [], [], []);
      g.setNode("D", ["A", "B"], [], [], []); g.setNode("X", ["X"], [], [], []);
      const cmp = (a, b) => a.localeCompare(b);
      return {
        roots: g.roots().sort(), kidsA: g.childrenOf("A").sort(),
        d1: g.collect(null, 1, cmp).cards.map((c) => c.path),
        dAll: g.collect("A", 0, cmp),
        capped: g.collect(null, 0, cmp, 2).truncated,
        anc: g.ancestry("C", cmp), desc: [g.isDescendant("A", "C"), g.isDescendant("C", "A")],
        self: g.parentsOf("X"),
      };
    });
    assert.deepEqual(r.roots, ["A", "X"]);
    assert.deepEqual(r.kidsA, ["B", "D"]);
    assert.deepEqual(r.d1, ["A", "X"]);
    assert.deepEqual(r.dAll.cards.map((c) => `${c.path}${c.depth}`), ["B1", "C2", "D2"], "D is reached through B first");
    assert.equal(r.dAll.skippedRepeats, 1, "D under A and under B is shown once");
    assert.equal(r.capped, true);
    assert.deepEqual(r.anc, ["A", "B"]);
    assert.deepEqual(r.desc, [true, false]);
    assert.deepEqual(r.self, [], "a card is never its own parent");
  });

  test("a cycle of parents doesn't hang and has no roots", async () => {
    const r = await ev(() => {
      const g = new HierarchyGraph();
      g.setNode("A", ["B"], [], [], []); g.setNode("B", ["A"], [], [], []);
      return { roots: g.roots(), cards: g.collect("A", 0, () => 0).cards.map((c) => c.path), anc: g.ancestry("A", () => 0) };
    });
    assert.deepEqual(r, { roots: [], cards: ["B"], anc: ["B"] });
  });

  test("the vault graph resolves parents and keeps unresolved ones", async () => {
    const r = await ev(async () => {
      await writeRaw("cards/Kid.md", '---\nparents:\n  - "[[Projects/Shop]]"\n  - "[[Nowhere]]"\n---\n');
      setGraph(buildGraph());
      return { ps: graph.parentsOf("cards/Kid.md"), un: graph.unresolvedParentsOf("cards/Kid.md"), back: graph.backlinksOf("cards/Projects/Shop.md") };
    });
    assert.deepEqual(r, { ps: ["cards/Projects/Shop.md"], un: ["Nowhere"], back: ["cards/Projects/Home.md"] });
  });

  test("cards are the notes in cards/ and daily notes/", async () => {
    assert.deepEqual(await ev(() => ["cards/Projects/Home.md", "Cards/Old.md", "daily notes/2026-11-05.md", "attachments/a.md", "Elsewhere/x.md", "cards/pic.png"].map(isCard)),
      [true, true, true, false, false, false]);
  });

  test("manual order: child_order first, then order, then name", async () => {
    const r = await ev(async () => {
      await writeRaw("cards/P.md", '---\nchild_order:\n  - "[[c3]]"\n  - "[[c1]]"\n---\n');
      for (const [n, o] of [["c1", ""], ["c2", "order: 1\n"], ["c3", ""], ["c4", "order: 2\n"], ["c10", ""]]) await writeRaw("cards/" + n + ".md", `---\nparents: ["[[P]]"]\n${o}---\n`);
      setGraph(buildGraph());
      const kids = (mode) => graph.sortedChildren("cards/P.md", makeComparator(mode)).map(baseName);
      return { manual: kids("manual"), name: kids("name") };
    });
    assert.deepEqual(r.manual, ["c3", "c1", "c2", "c4", "c10"]);
    assert.deepEqual(r.name, ["c1", "c2", "c3", "c4", "c10"], "numbers sort naturally");
  });

  test("reorderBlock", async () => {
    assert.deepEqual(await ev(() => [
      reorderBlock(["a", "b", "c", "d"], ["d"], "b", "before"),
      reorderBlock(["a", "b", "c", "d"], ["a", "b"], "c", "after"),
      reorderBlock(["a", "b"], ["c"], null),
      reorderBlock(["a", "b"], ["a"], "a", "after"),
    ]), [["a", "d", "b", "c"], ["c", "a", "b", "d"], ["a", "b", "c"], ["b", "a"]]);
  });
});

describe("text that is not UTF-8", () => {
  test("such a note is not opened (its next save would damage it), and the user is told which", async () => {
    await openVault({ demo: false });
    const r = await ev(async () => {
      const told = [];
      const off = on("notice", (text) => told.push(text));
      const fs = new MemoryFS("Mixed", "demo");
      fs.add("cards/Ok.md", "ok");
      fs.add("cards/Latin1.md", new Blob([new Uint8Array([0x63, 0x61, 0x66, 0xe9])])); // "café" in Latin-1
      await loadVault(fs);
      off();
      return { told, notes: [...vault.notes.keys()], file: [...new Uint8Array(await (await fs.readFile("cards/Latin1.md")).arrayBuffer())] };
    });
    assert.deepEqual(r.notes, ["cards/Ok.md"]);
    assert.deepEqual(r.file, [0x63, 0x61, 0x66, 0xe9], "the file is left as it was");
    assert.ok(r.told.some((x) => /not UTF-8.*Latin1/.test(x)), String(r.told));
  });
});
