// Unit tests for web/src/js/core/: the pure logic runs in Node directly, without the page or a browser.
// (The page tests in the other files drive the same code through the real page.)
import { test, describe, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

// core/frontmatter.js reads YAML with the page's js-yaml (a global, as on the page)
runInThisContext(readFileSync(new URL("../web/src/vendor/js-yaml.js", import.meta.url), "utf8"));

const { t, ct, pluralIndex, setLang, LANG } = await import("../web/src/js/core/i18n.js");
const { baseName, dirName, norm, esc, plainText } = await import("../web/src/js/core/util.js");
const { formatMoment } = await import("../web/src/js/core/dates.js");
const fm = await import("../web/src/js/core/frontmatter.js");
const { HierarchyGraph, reorderBlock } = await import("../web/src/js/core/graph.js");
const { computeModel, filterActive } = await import("../web/src/js/core/board-model.js");
const org = await import("../web/src/js/core/org.js");
const tables = await import("../web/src/js/core/tables.js");

const withLang = (l, fn) => { const was = LANG; setLang(l); try { return fn(); } finally { setLang(was); } };

describe("i18n and helpers", () => {
  test("a table of names comes back as it is (the date picker's repeat units)", () => {
    assert.equal(ct("every").w, "Every week");
  });
  test("t: language, English fallback, the key itself, {vars} and plural forms", () => {
    assert.equal(t("back"), "Back");
    assert.equal(withLang("ru", () => t("back")), "Назад");
    assert.equal(t("no such key"), "no such key");
    assert.equal(t("writeFailed", { name: "A", msg: "disk full" }), "Couldn't save “A”: disk full");
    assert.deepEqual(withLang("ru", () => [1, 3, 5, 11, 21, 22].map(pluralIndex)), [0, 1, 2, 2, 0, 1]);
    assert.deepEqual([1, 2].map(pluralIndex), [0, 1]);
  });

  test("paths and text", () => {
    assert.equal(baseName("Cards/Home.md"), "Home");
    assert.equal(baseName("a/b/pic.png"), "pic.png");
    assert.equal(dirName("Cards/Sub/Home.md"), "Cards/Sub");
    assert.equal(dirName("Home.md"), "");
    assert.equal(norm("Ёлка"), "елка");
    assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  test("formatMoment", () => {
    assert.equal(formatMoment(new Date(2026, 9, 29, 14, 5, 9), "YYYY-MM-DD HH:mm:ss"), "2026-10-29 14:05:09");
    assert.equal(formatMoment(new Date(2026, 0, 5), "YYYY/MM-DD"), "2026/01-05");
  });
});

describe("frontmatter", () => {
  test("splitNote", () => {
    assert.deepEqual(fm.splitNote("---\na: 1\n---\nbody"), { fm: "---\na: 1\n---\n", body: "body" });
    assert.deepEqual(fm.splitNote("no frontmatter\n---\n"), { fm: "", body: "no frontmatter\n---\n" });
    assert.deepEqual(fm.splitNote("---\r\na: 1\r\n---\r\nwin"), { fm: "---\r\na: 1\r\n---\r\n", body: "win" });
  });

  test("YAML in and out", () => {
    assert.deepEqual(fm.parseYaml("date: 2026-01-02\nn: 5\nyes: yes"), { date: "2026-01-02", n: 5, yes: "yes" });
    assert.deepEqual(fm.parseYaml("- a\n- b"), {});
    assert.equal(fm.dumpYaml({ parents: ["[[A]]"], title: "x: y" }), 'parents:\n  - "[[A]]"\ntitle: "x: y"\n');
  });

  test("parents, tags and links", () => {
    assert.deepEqual(fm.parentLinkpaths(["[[A]]", "[[B|x]]", "[[A]]"]), ["A", "B"]);
    assert.deepEqual(fm.parentLinkpaths(fm.parseYaml("p: [[A]]").p), ["A"]);
    assert.deepEqual(fm.parentLinkpaths(null), []);
    assert.deepEqual(fm.toStringList([["A"], "[[B]]", 3]), ["[[A]]", "[[B]]"]);
    assert.deepEqual(fm.noteTags({ tag: "a, b c" }, ""), ["#a", "#b", "#c"]);
  });

  test("templates", () => {
    assert.equal(fm.fillTemplate("{{title}} {{date}} {{time}} {{ date:YYYY/MM }}", "T", new Date(2026, 0, 5, 9, 7)), "T 2026-01-05 09:07 2026/01");
  });
});

describe("hierarchy graph", () => {
  // Home ← Garden ← Shed, Home ← Kitchen; Shed also under Kitchen (two parents)
  const g = new HierarchyGraph();
  g.setNode("Home", [], [], [], ["Kitchen", "Garden"]);
  g.setNode("Garden", ["Home"], [], ["Shed"], []);
  g.setNode("Kitchen", ["Home"], ["Missing"], [], []);
  g.setNode("Shed", ["Garden", "Kitchen"], [], [], []);
  const byName = (a, b) => a.localeCompare(b);

  test("parents, children, roots, backlinks", () => {
    assert.deepEqual(g.roots(), ["Home"]);
    assert.deepEqual(g.parentsOf("Shed").sort(), ["Garden", "Kitchen"]);
    assert.deepEqual(g.childrenOf("Home").sort(), ["Garden", "Kitchen"]);
    assert.deepEqual(g.unresolvedParentsOf("Kitchen"), ["Missing"]);
    assert.deepEqual(g.backlinksOf("Shed"), ["Garden"]);
    assert.equal(g.positionIn("Home", "Garden"), 1);
    assert.ok(g.isDescendant("Home", "Shed"));
    assert.ok(!g.isDescendant("Shed", "Home"));
  });

  test("collect walks levels once per card", () => {
    const one = g.collect(null, 1, byName);
    assert.deepEqual(one.cards.map((c) => c.path), ["Home"]);
    const all = g.collect("Home", 0, byName);
    assert.deepEqual(all.cards.map((c) => `${c.path}:${c.depth}`), ["Garden:1", "Shed:2", "Kitchen:1"]);
    assert.equal(all.skippedRepeats, 1, "Shed is shown once although it has two parents");
    assert.equal(g.collect("Home", 0, byName, 2).truncated, true);
  });

  test("countBelow counts what collect lists, once per card, and keeps the count", () => {
    for (const p of [null, "Home", "Garden", "Kitchen", "Shed"]) assert.equal(g.countBelow(p), g.collect(p, 0, byName).cards.length, String(p));
    assert.equal(g.countBelow("Home"), 3, "Shed once although it has two parents");
    assert.equal(g.counts.get("Home"), 3);
    const c = new HierarchyGraph();
    c.setNode("A", ["B"], [], [], []); c.setNode("B", ["A"], [], [], []); c.setNode("C", ["A"], [], [], []);
    assert.equal(c.countBelow("A"), c.collect("A", 0, byName).cards.length, "a cycle ends");
    c.setNode("D", ["C"], [], [], []);
    assert.equal(c.countBelow("A"), 3, "a new card clears the kept counts");
  });

  test("reorderBlock", () => {
    assert.deepEqual(reorderBlock(["a", "b", "c", "d"], ["d"], "b", "before"), ["a", "d", "b", "c"]);
    assert.deepEqual(reorderBlock(["a", "b", "c", "d"], ["a", "b"], "c", "after"), ["c", "a", "b", "d"]);
    assert.deepEqual(reorderBlock(["a", "b"], ["c"], null), ["a", "b", "c"]);
  });
});

describe("board model", () => {
  const g = new HierarchyGraph();
  for (const [p, parents] of [["Home", []], ["Red one", ["Home"]], ["Blue one", ["Home"]], ["Deep", ["Red one"]]]) g.setNode(p, parents, [], [], []);
  const cards = { cmp: (a, b) => a.localeCompare(b), tagsOf: (p) => (p === "Deep" ? ["#x"] : []), textOf: (p) => p + "\nbody of " + p, maxCards: 100 };
  const view = (o = {}) => ({ target: "Home", ...o, filter: { query: "", tags: [], ...o.filter } });
  const paths = (m) => m.shown.map((c) => c.path);

  test("the list shows the target's children, notebooks first; the total counts every level below it", () => {
    const m = computeModel(g, view(), cards);
    assert.deepEqual(paths(m), ["Red one", "Blue one"], "Red one has a child: it is a notebook");
    assert.deepEqual(m.shown.map((c) => !!c.folder), [true, false]);
    assert.equal(m.total, 3);
    assert.equal("blocks" in m, false, "no grouping");
  });

  test("a search keeps the sort order and marks no notebooks", () => {
    const m = computeModel(g, view({ filter: { query: "one" } }), cards);
    assert.deepEqual(paths(m), ["Blue one", "Red one"]);
    assert.ok(m.shown.every((c) => !c.folder));
  });

  test("filters search every level: tag, words", () => {
    assert.ok(!filterActive(view().filter));
    assert.deepEqual(paths(computeModel(g, view({ filter: { tags: ["#x"] } }), cards)), ["Deep"]);
    assert.deepEqual(paths(computeModel(g, view({ filter: { query: "BODY deep" } }), cards)), ["Deep"]);
    assert.deepEqual(paths(computeModel(g, view({ target: "Red one", filter: { query: "one" } }), cards)), [], "only below the target");
    assert.deepEqual(paths(computeModel(g, view({ target: "Red one", filter: { query: "one", scope: "all" } }), cards)), ["Blue one", "Red one"], "or the whole vault");
  });

  test("maxCards", () => {
    const m = computeModel(g, view({ filter: { query: "one" } }), { ...cards, maxCards: 1 });
    assert.equal(m.truncated, true);
    assert.equal(m.shown.length, 1);
  });
});

describe("tasks", () => {
  before(() => mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 29, 10, 0) }));
  after(() => mock.timers.reset());
  const apply = (src, fn) => { const L = src.split("\n"); const msg = fn(L); return { text: L.join("\n"), msg }; };

  test("timestamps", () => {
    assert.deepEqual(org.orgTsParse("<2026-10-29 Thu 9:05>"), { active: true, dn: org.odn(2026, 10, 29), time: 545, end: null, rep: null, warn: null });
    assert.equal(org.orgTsParse("no date"), null);
    const ts = org.orgTsParse("<2026-10-22 Thu +1w>");
    assert.ok(org.orgOccursOn(ts, org.odn(2026, 10, 29)));
    assert.ok(!org.orgOccursOn(ts, org.odn(2026, 10, 30)));
    assert.equal(org.orgTsStr(org.orgTsParse("<2026-10-29 Thu 10:00-11:30>")), "<2026-10-29 Thu 10:00-11:30>");
  });

  test("the date reader", () => {
    assert.equal(org.orgReadDate("++2", org.odn(2026, 12, 1)).dn, org.odn(2026, 12, 3));
    assert.equal(org.orgReadDate("tomorrow 2pm").time, 840);
    assert.equal(org.orgReadDate("tomorrow").dn, org.odn(2026, 10, 30));
  });

  test("states and headings", () => {
    assert.equal(org.taskState("X").id, "done");
    assert.equal(org.orgNextState("/"), "x");
    assert.equal(org.orgLine("## [ ] heading").box, null, "a heading is never a task");
    assert.deepEqual(org.orgHead("[#A] Call :x:"), { pri: "A", title: "Call", tags: ["x"] });
  });

  test("closing, reopening and repeating", () => {
    const done = apply("- [ ] Task\n  SCHEDULED: <2026-10-29 Thu>", (L) => org.orgSetState(L, 0, "x"));
    assert.equal(done.text, "- [x] Task\n  CLOSED: [2026-10-29 Thu 10:00] SCHEDULED: <2026-10-29 Thu>");
    assert.equal(apply(done.text, (L) => org.orgSetState(L, 0, " ")).text, "- [ ] Task\n  SCHEDULED: <2026-10-29 Thu>");
    assert.equal(apply("- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>", (L) => org.orgSetState(L, 0, "x")).text, "- [ ] Run\n  SCHEDULED: <2026-10-29 Thu +1w>");
  });

  test("a note's entries and the agenda's day", () => {
    const note = { path: "Work.md", raw: "## Work :work:\n- [ ] [#A] Report\n  SCHEDULED: <2026-10-29 Thu 10:00>\n- [/] Call #home\n  DEADLINE: <2026-10-31 Sat>\n- Dentist <2026-10-29 Thu 14:00>\n- [x] box\n- [-] gone", fm: {} };
    const es = org.orgParse(note);
    assert.deepEqual(es.map((e) => [e.kind, e.kw, e.pri, e.title, e.alltags, e.done]), [
      ["item", "todo", "A", "Report", ["work"], false],
      ["item", "doing", null, "Call #home", ["work", "home"], false], // tags are inherited from the heading above
      ["event", null, null, "Dentist", ["work"], false],
      ["item", "done", null, "box", ["work"], true],
      ["item", "cancel", null, "gone", ["work"], true],
    ]);
    const T = org.onow().dn;
    assert.deepEqual(org.orgDayEntries(T, es, T).map((x) => [x.label, x.e.title]), [["Scheduled:", "Report"], ["", "Dentist"], ["In 2 days:", "Call #home"]], "a deadline shows up days early");
  });
});

describe("tables", () => {
  test("finding and parsing", () => {
    const found = tables.findTables("```\n| a | b |\n|---|---|\n```\n> | q | w |\n> |---|---|\n\nx | y\n--|--\n1 | 2\nafter").map((x) => x.lines);
    assert.deepEqual(found, [["x | y", "--|--", "1 | 2"]]);
    assert.deepEqual(tables.tableCells("| a\\|b | | c |"), ["a\\|b", "", "c"]);
    assert.deepEqual(tables.parseTable(["| a | b | c |", "| :- | :-: | -: |", "| 1 |"]), { rows: [["a", "b", "c"], ["1", "", ""]], align: ["left", "center", "right"] });
  });

  test("formatting lines up wide characters", () => {
    assert.equal(tables.formatTable({ rows: [["Name", "N"], ["日本", "1"]], align: ["center", "right"] }).text, "| Name | N   |\n| :--: | --: |\n| 日本 | 1   |");
  });

  test("a row op rewrites the table", () => {
    const text = "| a | b |\n| - | - |\n| 1 | 2 |";
    const tb = tables.findTables(text)[0];
    const r = tables.tableEdit(text, tb, "rowBelow", 1, 0);
    assert.equal(r.insert.split("\n").length, 4);
  });

  test("range ops move, delete and paste blocks of rows and columns", () => {
    const text = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |", tb = tables.findTables(text)[0];
    const run = (op, s, arg) => { const o = tables.tableRangeEdit(text, tb, op, s, arg); return [o.insert && tables.parseTable(o.insert.split("\n")).rows.map((r) => r.join("")), o.rect]; };
    assert.deepEqual(run("moveRows", { r0: 1, r1: 2, c0: 0, c1: 2 }, 4), [["abc", "789", "123", "456"], { r0: 2, r1: 3, c0: 0, c1: 2 }]);
    assert.deepEqual(run("moveCols", { r0: 0, r1: 3, c0: 2, c1: 2 }, 0)[0], ["cab", "312", "645", "978"]);
    assert.deepEqual(run("rowDelete", { r0: 0, r1: 2, c0: 0, c1: 2 })[0], ["abc", "789"], "the header stays");
    assert.deepEqual(run("colDelete", { r0: 0, r1: 3, c0: 0, c1: 2 }), ["", null], "every column takes the table");
    assert.deepEqual(run("paste", { r0: 3, r1: 3, c0: 2, c1: 2 }, [["x", "y"], ["z", "w"]]), [["abc", "123", "456", "78xy", "zw"], { r0: 3, r1: 4, c0: 2, c1: 3 }], "the table grows");
    assert.deepEqual(run("paste", { r0: 1, r1: 2, c0: 0, c1: 0 }, [["0"]])[0], ["abc", "023", "056", "789"], "one value fills the selection");
  });

  test("clipboard text as cells: a spreadsheet's tabs (quoted values too) or a Markdown table", () => {
    assert.deepEqual(tables.clipboardGrid('a\t"b\nc"\td\n1\t2|x\n'), [["a", "b<br>c", "d"], ["1", "2\\|x", ""]]);
    assert.deepEqual(tables.clipboardGrid("| q | w |\n|--|--|\n| 1 | 2 |"), [["q", "w"], ["1", "2"]]);
    assert.equal(tables.clipboardGrid("plain text"), null);
    assert.equal(tables.gridMarkdown([["a\\|b<br>c"]]), "a|b\nc", "one cell copies as its text");
  });
});

describe("plain text previews", () => {
  test("plainText keeps the words of a note and drops its Markdown", () => {
    const md = "## Rates\n\n| Format | Hours |\n| --- | :-: |\n| Call | 0.5–1 h |\n\n- [ ] **buy** [[Milk|milk]] at [the shop](http://x)\n> [!info]+ Tip\n> text `code`\n```js\nlet x = 1\n```\n![[a.png]] ![alt](b.jpg) end";
    assert.equal(plainText(md), "Rates · Format Hours Call 0.5–1 h · buy milk at the shop Tip text code · end");
  });
  test("plainText drops #tags that end a line or fill it (they show as chips); a tag in a sentence and #42 stay", () => {
    assert.equal(plainText("An amphitheatre.\n\n- [ ] Visit at sunrise\n\n#travel"), "An amphitheatre. Visit at sunrise");
    assert.equal(plainText("Plans #work #home\nI love #travel a lot"), "Plans I love #travel a lot");
    assert.equal(plainText("Fixed issue #42"), "Fixed issue #42");
    assert.equal(plainText("C# is a language"), "C# is a language");
  });
  test("plainText drops the markup of tasks: every box, priorities, planning lines and :tags: (SRCH-4)", () => {
    const md = "- [/] [#A] Book the tour :travel:\n  DEADLINE: <2026-11-13 Fri> SCHEDULED: <2026-11-11 Wed>\n  Call first.\n- [<] [#C] Order the book\n- [>] Plan the trip\n- [-] Renew the pass\n- [x] Set up\n  CLOSED: [2026-11-10 Tue 18:20]\n1. [ ] Numbered\n- Time 10:30: not a tag";
    assert.equal(plainText(md, 1000), "Book the tour Call first. Order the book · Plan the trip · Renew the pass · Set up · Numbered · Time 10:30: not a tag");
  });
  test("plainText keeps list items and paragraphs apart, but not after a sentence or a label (#21)", () => {
    assert.equal(plainText("Ideas that don't belong anywhere yet.\n\n1. A notebook per project\n2. Weekly review note\n"), "Ideas that don't belong anywhere yet. A notebook per project · Weekly review note");
    assert.equal(plainText("One line\nsoft wrap\n\nSecond para\n\n\n"), "One line soft wrap · Second para", "a soft line break is a space; no separator at either end");
  });
  test("plainText drops template placeholders (#21)", () => {
    assert.equal(plainText("**Author:** \n**Read:** {{date}}\n\n## Notes\n"), "Author: Read: Notes");
    assert.equal(plainText("Made {{date:YYYY-MM-DD}} for {{title}}"), "Made for");
  });
  test("plainText links show their target or alias, and the text is cut to a length", () => {
    assert.equal(plainText("See [[Notes/Rome#Forum]] and [[Rome|the city]]"), "See Notes/Rome and the city");
    assert.equal(plainText("word ".repeat(100), 20), "word word word word ");
  });
});

const { embedSection, embedAllowed, EMBED_DEPTH } = await import("../web/src/js/core/embed.js");
describe("embedded notes (LINK-1, LINK-2)", () => {
  const body = "Intro\n\n# Trip\n\nPack.\n\n## Day 1\n\nWalk.\n\n```md\n# Not a heading\n```\n\n## Day 2  ##\n\nRest.\n\n# Home\n\nBack.\n";
  test("without a heading an embed shows the whole note", () => assert.equal(embedSection(body, ""), body));
  test("a heading's section runs to the next heading of its level or higher, past headings in code", () => {
    assert.equal(embedSection(body, "Day 1"), "## Day 1\n\nWalk.\n\n```md\n# Not a heading\n```\n");
    assert.equal(embedSection(body, "trip"), "# Trip\n\nPack.\n\n## Day 1\n\nWalk.\n\n```md\n# Not a heading\n```\n\n## Day 2  ##\n\nRest.\n");
    assert.equal(embedSection(body, "Day 2"), "## Day 2  ##\n\nRest.\n", "closing #s are not part of the name");
    assert.equal(embedSection(body, "Home"), "# Home\n\nBack.\n", "the last section runs to the end");
    assert.equal(embedSection(body, "Not a heading"), null);
    assert.equal(embedSection(body, "Nowhere"), null);
  });
  test("embeds go three levels deep and never round a cycle", () => {
    assert.equal(EMBED_DEPTH, 3);
    assert.equal(embedAllowed("B", 0, ["A"]), null);
    assert.equal(embedAllowed("D", 2, ["A", "B", "C"]), null);
    assert.equal(embedAllowed("E", 3, ["A", "B", "C", "D"]), "depth");
    assert.equal(embedAllowed("A", 1, ["A", "B"]), "cycle");
    assert.equal(embedAllowed("A", 0, ["A"]), "cycle", "a note does not embed itself");
  });
});

const { parseQuery, WordIndex, matchRank, headingsText } = await import("../web/src/js/core/search.js");
describe("search (SRCH-1, SRCH-2, SRCH-3)", () => {
  test("a query's words, and +tag / -tag as tag filters", () => {
    assert.deepEqual(parseQuery("Roman  +Travel -#draft ёлка -5 + c++"), { words: ["roman", "елка", "-5", "+", "c++"], include: ["travel"], exclude: ["draft"] });
  });
  test("the index gives every note a substring search finds, and follows changes", () => {
    const ix = new WordIndex({ commonShare: 1 }), notes = new Map();
    const put = (p, raw) => notes.set(p, { raw });
    put("a", "Gravity-fed aqueducts"); put("b", "An amphitheatre"); put("c", "Aqueduct bridges and canals");
    ix.update(notes, (n) => n.raw);
    assert.deepEqual([...ix.candidates(["aqueduct"])].sort(), ["a", "c"], "part of a word is found");
    assert.deepEqual([...ix.candidates(["aqueduct", "brid"])], ["c"]);
    assert.equal(ix.candidates(["c++"]), null, "a word with other characters narrows nothing");
    assert.deepEqual([...ix.candidates(["zzz"])], []);
    put("b", "An amphitheatre by an aqueduct");
    notes.delete("c");
    assert.equal(ix.update(notes, (n) => n.raw), 1, "only the changed note is indexed again");
    assert.deepEqual([...ix.candidates(["aqueduct"])].sort(), ["a", "b"]);
    assert.equal(ix.postings.has("canals"), false, "a deleted note's words go");
  });
  test("a word in most notes narrows nothing: reading the texts is quicker", () => {
    const ix = new WordIndex(), notes = new Map([["a", "rome forum"], ["b", "rome baths"], ["c", "paris"]].map(([p, raw]) => [p, { raw }]));
    ix.update(notes, (n) => n.raw);
    assert.equal(ix.candidates(["rome"]), null, "in two notes of three");
    assert.deepEqual([...ix.candidates(["rome", "forum"])], ["a"], "a rarer word still narrows");
  });
  test("a match in the title ranks above one in a heading, above one in the text", () => {
    assert.equal(matchRank(["rome"], "Rome trip", ""), 3);
    assert.equal(matchRank(["rome", "day"], "Rome", "Day 1\n"), 2);
    assert.equal(matchRank(["rome"], "Trip", "Plans\n"), 1);
    assert.equal(headingsText("# One\ntext #tag\n### Three ##\n    # code"), "One\nThree ##\n");
  });
});

describe("the Russian interface's words (#30)", () => {
  test("the agenda is «Повестка», never «Агенда»", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../web/src/js/core/strings.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /[Аа]генд/);
    assert.match(src, /tabAgenda: "Повестка"/);
  });
});

describe("quick add: one line → a task (core/quick-add.js)", async () => {
  const { parseQuickAdd, quickAddQuery } = await import("../web/src/js/core/quick-add.js");
  const notes = [{ name: "Project X", path: "cards/Project X.md" }, { name: "Project", path: "cards/Project.md" }];
  const read = (s) => org.orgReadDate(s);

  test("the date, the #tags and the @note come out of the title", () => {
    const p = parseQuickAdd("Call Anna fri 14:00 #work @Project X", { notes });
    assert.equal(p.title, "Call Anna");
    assert.deepEqual([p.date.text, p.date.r.dn, p.date.r.time], ["fri 14:00", read("fri").dn, 840]);
    assert.deepEqual(p.tags.map((x) => x.name), ["work"]);
    assert.deepEqual([p.note.name, p.note.path], ["Project X", "cards/Project X.md"], "the longest name that fits");
  });

  test("Russian dates, with в/at gluing the words and dropped before them", () => {
    let p = parseQuickAdd("Купить хлеб завтра в 10:00 #дом");
    assert.deepEqual([p.title, p.date.text, p.date.r.dn, p.date.r.time], ["Купить хлеб", "завтра в 10:00", read("завтра").dn, 600]);
    p = parseQuickAdd("Позвонить в пятницу");
    assert.deepEqual([p.title, p.date.r.dn], ["Позвонить", read("fri").dn]);
    p = parseQuickAdd("Meet at 2pm on monday");
    assert.deepEqual([p.title, p.date.r.dn, p.date.r.time], ["Meet", read("mon").dn, 840]);
    assert.deepEqual(parseQuickAdd("Report 5 ноября").date.r.dn, read("5 ноя").dn);
    assert.deepEqual(parseQuickAdd("Pay 2026-12-01 +1m").date.r.rep, { type: "+", n: 1, u: "m" });
  });

  test("words that only look like dates stay in the title", () => {
    for (const s of ["Buy 5 apples", "Read about C# today-ish", "Call Tom", "срочно ответить", "may be later"]) assert.equal(parseQuickAdd(s).date, null, s);
    assert.equal(parseQuickAdd("C# notes").tags.length, 0, "# only after a space");
    assert.equal(parseQuickAdd("#5 issue").tags.length, 0, "digits alone are not a tag");
    const p = parseQuickAdd("Plan the friday party", { keepDate: ["friday"] });
    assert.deepEqual([p.title, p.date], ["Plan the friday party", null], "the date chip's × keeps the words");
  });

  test("an @ no note is called is kept apart, with no path", () => {
    const p = parseQuickAdd("Review @Nowhere, then mail", { notes });
    assert.deepEqual([p.title, p.note.name, p.note.path], ["Review, then mail", "Nowhere", null]);
  });

  test("what is being typed after @ or #", () => {
    assert.deepEqual(quickAddQuery("Call @Proj", 10), { kind: "note", start: 5, query: "Proj" });
    assert.deepEqual(quickAddQuery("Call @Project X", 15), { kind: "note", start: 5, query: "Project X" }, "a note's name may have spaces");
    assert.deepEqual(quickAddQuery("x #wo", 5), { kind: "tag", start: 2, query: "wo" });
    assert.equal(quickAddQuery("x # a", 5), null);
    assert.equal(quickAddQuery("mail@home", 9), null, "@ inside a word");
  });
});
