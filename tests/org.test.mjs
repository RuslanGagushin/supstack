// Tasks: timestamps, the date reader, task states, repeaters, parsing a note, the agenda and match queries.
// The clock is frozen at Thursday 2026-10-29 10:00.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";
import * as H from "./harness.mjs";

const NOW = "2026-10-29T10:00:00";
const NOTE = `---
tags: [home]
---
# Project :work:
- [ ] [#A] Write report :urgent:
  DEADLINE: <2026-10-27 Tue>
  - [x] outline
  - [ ] draft
  - [ ] review
- [/] Call Bob
  SCHEDULED: <2026-10-25 Sun>
- [x] Old thing
  CLOSED: [2026-10-20 Tue 09:00]
## Meeting <2026-10-29 Thu 14:00-15:00>
## Plain heading
SCHEDULED: <2026-10-31 Sat>
- [<] Parts :shop:
  DEADLINE: <2026-11-05 Thu -10d>
- [-] Dropped idea
- [>] Moved elsewhere
\`\`\`
- [ ] inside code
\`\`\`
- [ ] errand task #errand
- [ ] loose checkbox
`;
const day = (y, m, d) => ev(([y, m, d]) => odn(y, m, d), [y, m, d]);

before(() => openVault({ demo: false, time: NOW, notes: { "cards/Work.md": NOTE, "cards/Gym.md": "- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>\n" } }));

describe("timestamps", () => {
  test("parse and print round-trip with time ranges, repeaters and warnings", async () => {
    const r = await ev(() => ["<2026-10-29 Thu 09:00-10:30 +1w -2d>", "[2026-01-05 Mon]", "<2026-02-01 Sun .+2m --3d>"].map((s) => orgTsStr(orgTsParse(s))));
    assert.deepEqual(r, ["<2026-10-29 Thu 09:00-10:30 +1w -2d>", "[2026-01-05 Mon]", "<2026-02-01 Sun .+2m --3d>"]);
    assert.deepEqual(await ev(() => orgTsParse("<2026-10-29 Thu 9:05>")), { active: true, dn: await day(2026, 10, 29), time: 545, end: null, rep: null, warn: null });
    assert.equal(await ev(() => orgTsParse("no date")), null);
  });

  test("repeaters: days, weeks, months clamp to the month's end", async () => {
    const r = await ev(() => {
      const w = orgTsParse("<2026-10-01 Thu +1w>"), m = orgTsParse("<2026-01-31 Sat +1m>"), plain = orgTsParse("<2026-10-01 Thu>");
      return [orgOccursOn(w, odn(2026, 10, 29)), orgOccursOn(w, odn(2026, 10, 30)), orgOccursOn(w, odn(2026, 9, 24)),
        orgOccursOn(m, odn(2026, 2, 28)), orgOccursOn(m, odn(2026, 3, 31)), orgOccursOn(plain, odn(2026, 10, 2))];
    });
    assert.deepEqual(r, [true, false, false, true, true, false]);
  });

  test("the date reader understands Org's shortcuts (today is Thu Oct 29)", async () => {
    const cases = { "": [2026, 10, 29], ".": [2026, 10, 29], today: [2026, 10, 29], tomorrow: [2026, 10, 30], "+3": [2026, 11, 1], "-1w": [2026, 10, 22],
      fri: [2026, 10, 30], thu: [2026, 10, 29], "2fri": [2026, 11, 6], "11-05": [2026, 11, 5], "3-01": [2027, 3, 1], "5": [2026, 11, 5], "30": [2026, 10, 30],
      "2026-12-01": [2026, 12, 1], "nov 5": [2026, 11, 5], "5 nov": [2026, 11, 5], "jan 2 2028": [2028, 1, 2], "05.11": [2026, 11, 5], "завтра": [2026, 10, 30], "пт": [2026, 10, 30] };
    for (const [input, [y, m, d]] of Object.entries(cases)) assert.equal(await ev((s) => orgReadDate(s)?.dn, input), await day(y, m, d), JSON.stringify(input));
    assert.equal(await ev(() => orgReadDate("++2", odn(2026, 12, 1)).dn), await day(2026, 12, 3), "++ counts from the current date");
    assert.deepEqual(await ev(() => { const r = orgReadDate("fri 14:00-15:30 +1w -2d"); return [r.time, r.end, r.rep, r.warn]; }), [840, 930, { type: "+", n: 1, u: "w" }, { first: false, n: 2, u: "d" }]);
    assert.equal(await ev(() => orgReadDate("tomorrow 2pm").time), 840);
    for (const bad of ["25:00", "someday", "12:00-24:30"]) assert.equal(await ev((s) => orgReadDate(s), bad), null, bad);
  });
});

describe("task states", () => {
  test("six states, three of them open; X reads as x", async () => {
    assert.deepEqual(await ev(() => TASK_STATES.map((x) => `${x.ch}${x.id}${x.open ? "+" : "-"}`)), [" todo+", "/doing+", "<wait+", "xdone-", "-cancel-", ">fwd-"]);
    assert.deepEqual(await ev(() => [taskState("X")?.id, taskState("?"), taskState(null)]), ["done", null, null]);
  });

  test("Ctrl+Enter steps [ ] → [/] → [x] and back; other states join the cycle", async () => {
    assert.deepEqual(await ev(() => [" ", "/", "x", "<", "-", ">", "X"].map((c) => orgNextState(c))), ["/", "x", " ", "x", " ", " ", " "]);
    assert.deepEqual(await ev(() => [" ", "/", "x"].map((c) => orgNextState(c, -1))), ["x", " ", "/"]);
  });

  test("a task's priority, title and tags", async () => {
    const r = await ev(() => { const info = orgLine("- [/] [#B] Fix the sink :home:plumbing:"); const o = orgHead(info.rest); return { box: info.box, o, back: orgBuild(info, o) }; });
    assert.equal(r.box, "/");
    assert.deepEqual(r.o, { pri: "B", title: "Fix the sink", tags: ["home", "plumbing"] });
    assert.equal(r.back, "- [/] [#B] Fix the sink :home:plumbing:");
    assert.equal(await ev(() => orgLine("- [?] not a state").box), null);
  });

  const apply = (src, fn, arg) => ev(({ src, fn, arg }) => { const L = src.split("\n"); const msg = globalThis[fn](L, 0, ...arg); return { text: L.join("\n"), msg }; }, { src, fn, arg });

  test("closing any task adds CLOSED (as org-log-done), reopening removes it", async () => {
    const done = await apply("- [ ] Task\n  SCHEDULED: <2026-10-29 Thu>", "orgSetState", ["x"]);
    assert.equal(done.text, "- [x] Task\n  CLOSED: [2026-10-29 Thu 10:00] SCHEDULED: <2026-10-29 Thu>");
    assert.equal(done.msg, "State: Done");
    assert.equal((await apply(done.text, "orgSetState", [" "])).text, "- [ ] Task\n  SCHEDULED: <2026-10-29 Thu>");
    assert.equal((await apply("- [/] Task\n  SCHEDULED: <2026-10-29 Thu>", "orgSetState", ["-"])).text, "- [-] Task\n  CLOSED: [2026-10-29 Thu 10:00] SCHEDULED: <2026-10-29 Thu>", "cancelling closes too");
    const milk = await apply("- [ ] buy milk", "orgSetState", ["x"]);
    assert.equal(milk.text, "- [x] buy milk\n  CLOSED: [2026-10-29 Thu 10:00]", "a task without dates gets a planning line of its own");
    assert.equal((await apply(milk.text, "orgSetState", ["<"])).text, "- [<] buy milk", "and loses it when it opens again");
    assert.equal((await apply("- [x] buy milk\n  CLOSED: [2026-10-29 Thu 10:00]", "orgSetState", ["-"])).text, "- [-] buy milk\n  CLOSED: [2026-10-29 Thu 10:00]", "closed to closed keeps the stamp");
    assert.equal((await apply("- [ ] parent\n  - [ ] child", "orgSetState", ["x"])).text, "- [x] parent\n  CLOSED: [2026-10-29 Thu 10:00]\n  - [ ] child", "the stamp goes right under the task, above its subtasks");
    assert.equal((await apply("1. item", "orgSetState", [" "])).text, "1. [ ] item", "a list item gets a box");
    const head = await apply("## Heading", "orgSetState", ["x"]);
    assert.deepEqual([head.text, head.msg], ["## Heading", null], "headings are never tasks");
  });

  test("repeating tasks move to the next date and keep their open state", async () => {
    assert.equal((await apply("- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>", "orgSetState", ["x"])).text, "- [ ] Run\n  SCHEDULED: <2026-10-29 Thu +1w>");
    assert.equal((await apply("- [/] Pay\n  DEADLINE: <2026-08-01 Sat ++1m>", "orgSetState", ["x"])).text, "- [/] Pay\n  DEADLINE: <2026-11-01 Sun ++1m>", "++ skips past today");
    assert.equal((await apply("- [ ] Water\n  SCHEDULED: <2026-10-01 Thu .+3d>", "orgSetState", ["x"])).text, "- [ ] Water\n  SCHEDULED: <2026-11-01 Sun .+3d>", ".+ counts from today");
    assert.equal((await apply("- [ ] Gone\n  SCHEDULED: <2026-10-22 Thu +1w>", "orgSetState", ["-"])).text, "- [-] Gone\n  CLOSED: [2026-10-29 Thu 10:00] SCHEDULED: <2026-10-22 Thu +1w>", "cancelling ends the repeats");
  });

  test("priorities, tags and shifting dates", async () => {
    const pri = async (src, dir) => (await apply(src, "orgSetPriority", [dir])).text;
    assert.deepEqual([await pri("- [ ] a", 1), await pri("- [ ] [#A] a", 1), await pri("- [ ] [#B] a", 1), await pri("- [ ] a", -1), await pri("- [ ] [#C] a", -1)],
      ["- [ ] [#A] a", "- [ ] a", "- [ ] [#A] a", "- [ ] [#C] a", "- [ ] a"]);
    assert.equal((await apply("- [ ] a :old:", "orgSetTags", [["x", "y"]])).text, "- [ ] a :x:y:");
    assert.equal((await apply("- [ ] a\n  DEADLINE: <2026-10-29 Thu 09:00>", "orgShift", ["dead", 3])).text, "- [ ] a\n  DEADLINE: <2026-11-01 Sun 09:00>");
    assert.equal((await apply("## Party <2026-10-29 Thu>", "orgShift", ["ts", -1])).text, "## Party <2026-10-28 Wed>");
    assert.equal((await apply("- [ ] a\n  SCHEDULED: <2026-10-29 Thu>", "orgSetPlanning", ["SCHEDULED", null])).text, "- [ ] a");
  });
});

describe("parsing a note", () => {
  const entries = () => ev(() => orgEntries(vault.notes.get("cards/Work.md")).map((e) => ({ kind: e.kind, kw: e.kw, pri: e.pri, title: e.title, tags: e.alltags, inh: e.inherited, cb: [e.cbDone, e.cbTotal], nested: e.nested, sched: e.sched?.dn ?? null, dead: e.dead?.dn ?? null, closed: !!e.closed, outline: e.outline })));

  test("tasks in every state and events; no headings, nothing from code blocks", async () => {
    const es = await entries();
    assert.deepEqual(es.map((e) => `${e.kind}:${e.kw ?? ""}:${e.title}`), [
      "item:todo:Write report", "item:done:outline", "item:todo:draft", "item:todo:review", "item:doing:Call Bob", "item:done:Old thing", "event::Meeting",
      "item:wait:Parts", "item:cancel:Dropped idea", "item:fwd:Moved elsewhere", "item:todo:errand task #errand", "item:todo:loose checkbox"]);
  });

  test("tags are inherited from the file, headings and parent tasks", async () => {
    const [report, outline, , , call, , , parts, , , errand] = await entries();
    assert.deepEqual(report.tags, ["home", "work", "urgent"]);
    assert.deepEqual(report.inh, ["home", "work"]);
    assert.deepEqual(outline.tags, ["home", "work", "urgent"], "a subtask inherits its parent's tags");
    assert.deepEqual(parts.tags, ["home", "work", "shop"]);
    assert.deepEqual(errand.tags, ["home", "work", "errand"], "a task's tags stop at its own subtree");
    assert.deepEqual(call.outline, ["Project"]);
  });

  test("planning lines, priorities and subtask counts", async () => {
    const [report, outline, , , call, old] = await entries();
    assert.equal(report.pri, "A");
    assert.equal(report.dead, await day(2026, 10, 27));
    assert.deepEqual(report.cb, [1, 3]);
    assert.deepEqual([report.nested, outline.nested], [false, true]);
    assert.equal(call.sched, await day(2026, 10, 25));
    assert.equal(old.closed, true);
  });

  test("card progress counts done tasks; cancelled and forwarded ones drop out", async () => {
    assert.deepEqual(await ev(() => cardTaskProgress("cards/Work.md")), { done: 2, n: 9 });
  });
});

describe("agenda", () => {
  const today = () => ev(() => { const T = onow().dn; return orgDayEntries(T, orgAll(), T).map((x) => `${x.label} ${x.e.title}`.trim()); });

  test("today: overdue deadline first, scheduled carry-over, events, warnings; nothing done", async () => {
    assert.deepEqual(await today(), ["Meeting", "2 d. ago: Write report", "In 7 d.: Parts", "Scheduled: Run", "Sched.5x: Call Bob"]);
  });

  test("with the log on, a task closed today is listed once, as closed", async () => {
    const kinds = await ev(async () => {
      await writeRaw("cards/Z.md", "- [x] Fix the mount\n  CLOSED: [2026-10-29 Thu 09:00] SCHEDULED: <2026-10-29 Thu>\n");
      const T = onow().dn;
      const r = [true, false].map((log) => orgDayEntries(T, orgAll(), T, { log }).filter((x) => x.e.title === "Fix the mount").map((x) => x.kind));
      await writeRaw("cards/Z.md", ""); // the vault is shared by the tests that follow
      return r;
    });
    assert.deepEqual(kinds, [["closed"], ["sched"]]);
  });

  test("a repeating entry shows on its future days, not past ones", async () => {
    const r = await ev(() => { const T = onow().dn; const on = (dn) => orgDayEntries(dn, orgAll(), T).map((x) => x.e.title); return [on(odn(2026, 11, 5)), on(odn(2026, 10, 22))]; });
    assert.ok(r[0].includes("Run"));
    assert.ok(r[0].includes("Parts"), "the deadline day itself");
    assert.ok(r[1].includes("Run"), "its own first day");
  });

  test("match queries: tags, properties, task states", async () => {
    const m = (q) => ev((q) => orgAll().filter(orgMatcher(q)).map((e) => e.title), q);
    assert.deepEqual(await m("+work -shop/!"), ["Write report", "draft", "review", "Call Bob", "errand task #errand", "loose checkbox"]);
    assert.deepEqual(await m("+work-shop"), [], "a hyphen is part of the tag name here (Markdown #tags), unlike Org's +work-boss");
    assert.deepEqual(await m("PRIORITY=A"), ["Write report"]);
    assert.deepEqual(await m("/wait|DOING"), ["Call Bob", "Parts"]);
    assert.deepEqual(await m("/done"), ["outline", "Old thing"]);
    assert.deepEqual(await m("errand|shop"), ["Parts", "errand task #errand"]);
    assert.deepEqual(await m("STATE=todo+urgent"), ["Write report", "draft", "review"], "subtasks inherit the tag");
    assert.deepEqual(await m("TODO=cancel"), ["Dropped idea"], "TODO= still names the state");
    assert.deepEqual(await m("CATEGORY=gym"), ["Run"]);
  });

  test("the agenda view lists today, t steps a task's state and a click on its box ticks it", async () => {
    const page = H.page;
    await ev(() => openTasksView(true, "agenda"));
    await page.waitForSelector(".ag-row");
    const text = await page.textContent(".ag-body");
    assert.match(text, /Write report/);
    assert.match(text, /Meeting/);
    assert.match(await page.getAttribute("#tasks-btn", "title"), /2 overdue|overdue/i);
    await ev(() => { const i = AGROWS.findIndex((x) => x.e.title === "Call Bob"); orgSelect(i); $(".ag-body").focus(); });
    await page.keyboard.press("t");
    await page.waitForFunction(() => vault.notes.get("cards/Work.md").raw.includes("- [x] Call Bob\n  CLOSED: [2026-10-29 Thu 10:00] SCHEDULED: <2026-10-25 Sun>"));
    await page.click(".ag-row:has-text('Run') .task-box");
    await page.waitForFunction(() => vault.notes.get("cards/Gym.md").raw === "- [ ] Run\n  SCHEDULED: <2026-10-29 Thu +1w>\n", null, { timeout: 5000 });
    await ev(() => $(".ag-body").focus());
    await page.keyboard.press("q");
    assert.equal(await ev(() => board.view), null);
    assert.equal(H.errors.length, 0, H.errors.join("\n"));
  });

  test("the task list view, all open states or one", async () => {
    await ev(() => { AG.todoKw = "ALL"; openTasksView(true, "todo"); });
    const titles = await H.page.$$eval(".ag-row .ag-title, .ag-row", (rows) => rows.map((r) => r.textContent));
    const all = titles.join("\n");
    for (const t of ["Write report", "Parts", "Run"]) assert.match(all, new RegExp(t));
    assert.doesNotMatch(all, /Old thing|Dropped idea|Moved elsewhere/);
    await ev(() => { AG.todoKw = "wait"; openTasksView(true, "todo"); });
    assert.deepEqual(await H.page.$$eval(".ag-row .ag-ttl", (rows) => rows.map((r) => r.textContent)), ["Parts"]);
    await ev(() => { AG.todoKw = "ALL"; });
  });
});
