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
    assert.equal(ct("every").w, "weekly");
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
    assert.deepEqual(org.orgDayEntries(T, es, T).map((x) => [x.label, x.e.title]), [["Scheduled:", "Report"], ["", "Dentist"], ["In 2 d.:", "Call #home"]], "a deadline shows up days early");
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
});

describe("plain text previews", () => {
  test("plainText keeps the words of a note and drops its Markdown", () => {
    const md = "## Rates\n\n| Format | Hours |\n| --- | :-: |\n| Call | 0.5–1 h |\n\n- [ ] **buy** [[Milk|milk]] at [the shop](http://x)\n> [!info]+ Tip\n> text `code`\n```js\nlet x = 1\n```\n![[a.png]] ![alt](b.jpg) end";
    assert.equal(plainText(md), "Rates Format Hours Call 0.5–1 h buy milk at the shop Tip text code end");
  });
  test("plainText links show their target or alias, and the text is cut to a length", () => {
    assert.equal(plainText("See [[Notes/Rome#Forum]] and [[Rome|the city]]"), "See Notes/Rome and the city");
    assert.equal(plainText("word ".repeat(100), 20), "word word word word ");
  });
});

