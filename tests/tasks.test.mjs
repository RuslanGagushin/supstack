// Tasks kept apart from the notes, in .supstack/tasks.jsonl: the file's format, the edits, moving a note's tasks out of
// it, links to notes by their frontmatter id, and the agenda's actions. The clock is frozen at Thursday 2026-10-29 10:00.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw, fsText, tick, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const NOW = "2026-10-29T10:00:00";
const WEEK = `---
tags: [home]
---
# Week :work:

Things to do.

- [ ] [#A] Write report :urgent:
  DEADLINE: <2026-10-27 Tue>
  Ask Anna for the numbers.
  - [x] outline
  - [ ] draft
- [/] Call Bob
  SCHEDULED: <2026-10-25 Sun>
- [x] Old thing
  CLOSED: [2026-10-20 Tue 09:00]
- [ ] milk
- [x] bread
- Dentist <2026-10-30 Fri 14:00-15:00> #health
\`\`\`
- [/] inside code
\`\`\`
`;
const tasksFile = async () => (await fsText(".supstack/tasks.jsonl")) ?? "";
const records = async () => (await tasksFile()).split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("the file", () => {
  before(() => openVault({ demo: false, time: NOW }));

  test("one task a line, sorted by id, empty fields left out; lines that are not tasks are kept", async () => {
    const r = await ev(() => {
      const { records, extra } = parseTasks('{"id":"b","state":"x","title":"B"}\n<<<<<<< HEAD\n{"id":"a","title":"A","tags":[],"pri":"","note":"n1","zz":1}\n');
      return { ids: [...records.keys()], extra, text: serializeTasks(records, extra) };
    });
    assert.deepEqual(r.ids, ["b", "a"]);
    assert.deepEqual(r.extra, ["<<<<<<< HEAD"]);
    assert.equal(r.text, '{"id":"a","state":" ","title":"A","note":"n1","zz":1}\n{"id":"b","state":"x","title":"B"}\n<<<<<<< HEAD\n');
  });

  test("closing a task stamps it; a repeating one moves to its next date instead", async () => {
    const r = await ev(() => {
      const a = { id: "a", state: " ", title: "A" }, b = { id: "b", state: " ", title: "B", sched: "<2026-10-22 Thu +1w>" };
      const m1 = taskSetState(a, "x"), m2 = taskSetState(b, "x");
      const again = taskSetState(a, " ");
      return { a, b, m1, m2, again };
    });
    assert.equal(r.a.state, " ");
    assert.equal(r.a.closed, undefined, "reopening drops the stamp");
    assert.equal(r.b.state, " ");
    assert.equal(r.b.sched, "<2026-10-29 Thu +1w>");
    assert.match(r.m2, /repeats/);
  });

  test("priority, tags, dates and shifting", async () => {
    const r = await ev(() => {
      const a = { id: "a", state: " ", title: "A", dead: "<2026-10-30 Fri>" };
      taskSetPriority(a, 1); const p1 = a.pri; taskSetPriority(a, 1); const p2 = a.pri ?? null;
      taskSetTags(a, ["#x", "y"]);
      taskSetPlan(a, "SCHEDULED", "<2026-11-01 Sun>");
      taskShift(a, "dead", 2);
      const ev = { id: "e", state: null, title: "E", when: "<2026-10-30 Fri 14:00>" };
      taskShift(ev, "ts", -1);
      return { p1, p2, a, when: ev.when, noState: taskSetState(ev, "x") };
    });
    assert.deepEqual([r.p1, r.p2], ["A", null]);
    assert.deepEqual(r.a.tags, ["x", "y"]);
    assert.equal(r.a.sched, "<2026-11-01 Sun>");
    assert.equal(r.a.dead, "<2026-11-01 Sun>");
    assert.equal(r.when, "<2026-10-29 Thu 14:00>");
    assert.equal(r.noState, null, "an event has no state");
  });

  test("a note's id goes into its frontmatter as a line, the rest as written", async () => {
    const r = await ev(() => [withNoteId("# Hi\n", "n1"), withNoteId("---\ntags: [a]   # mine\n---\nText\n", "n2"), withNoteId("---\nid: old\ntitle: x\n---\n", "n3")]);
    assert.deepEqual(r, ["---\nid: n1\n---\n# Hi\n", "---\nid: n2\ntags: [a]   # mine\n---\nText\n", "---\nid: n3\ntitle: x\n---\n"]);
  });
});

describe("moving a note's tasks out of it", () => {
  test("dated, prioritised and in-progress tasks and events move; plain boxes stay as a checklist", async () => {
    await openVault({ demo: false, time: NOW });
    const r = await ev((text) => extractTasks(text, "n1", { fm: { tags: ["home"] }, now: "T" }), WEEK);
    const by = Object.fromEntries(r.records.map((x) => [x.title, x]));
    assert.deepEqual(Object.keys(by).sort(), ["Call Bob", "Dentist #health", "Old thing", "Write report"].sort());
    assert.deepEqual(by["Write report"], { id: by["Write report"].id, state: " ", pri: "A", title: "Write report", tags: ["work", "urgent"], dead: "<2026-10-27 Tue>", note: "n1", created: "T", upd: "T" });
    assert.equal(by["Old thing"].closed, "[2026-10-20 Tue 09:00]");
    assert.equal(by["Dentist #health"].state, null);
    assert.equal(by["Dentist #health"].when, "<2026-10-30 Fri 14:00-15:00>");
    // what was under a task that moved stays, one level out; the event's date leaves its line; code is untouched
    assert.equal(r.raw, `---
tags: [home]
---
# Week :work:

Things to do.

Ask Anna for the numbers.
- [x] outline
- [ ] draft
- [ ] milk
- [x] bread
- Dentist #health
\`\`\`
- [/] inside code
\`\`\`
`);
    const again = await ev((text) => extractTasks(text, "n1", { now: "T" }).records.map((x) => x.id), WEEK);
    assert.deepEqual(again, r.records.map((x) => x.id), "the same note and line make the same id on every device");
  });

  test("an in-memory vault moves them on opening; the note gets an id and the tasks link to it", async () => {
    await openVault({ demo: false, time: NOW, notes: { "cards/Week.md": WEEK, "cards/Plain.md": "- [ ] just a list\n" } });
    await tick(200);
    const recs = await records();
    assert.equal(recs.length, 4);
    const note = await raw("cards/Week.md");
    const id = /^id: (\S+)$/m.exec(note)?.[1];
    assert.ok(id, note);
    assert.ok(recs.every((x) => x.note === id));
    assert.equal(await raw("cards/Plain.md"), "- [ ] just a list\n", "a note with only a checklist is left alone");
    const es = await ev(() => orgAll().map((e) => [e.title, e.category, e.path, e.inherited.join(",")]));
    assert.ok(es.some(([t, c, p, inh]) => t === "Write report" && c === "Week" && p === "cards/Week.md" && inh === "home"), JSON.stringify(es));
    assert.equal(await ev(() => undoStack.length), 0, "opening the vault leaves nothing to undo");
    assert.equal(await ev(() => movableTasks().tasks), 0);
  });

  test("a vault on disk asks first, keeps a copy of each note, and remembers the answer", async () => {
    await H.openNativeApp({ notes: { "cards/Week.md": WEEK }, expose: true });
    await H.page.waitForSelector(".modal .is-danger");
    await H.page.click(".modal .is-danger");
    await tick(400);
    const files = await ev(() => window.__vaultFiles);
    assert.ok(files[".supstack/tasks.jsonl"]?.text.includes("Write report"));
    const backup = Object.keys(files).find((p) => p.startsWith(".supstack/backup/") && p.endsWith("/cards/Week.md"));
    assert.ok(backup, Object.keys(files).join(", "));
    assert.equal(files[backup].text, WEEK);
    assert.doesNotMatch(files["cards/Week.md"].text, /Write report/);
    assert.equal(await ev(() => JSON.parse(localStorage.getItem("sn-tasks-moved:/vault"))), "moved");
  });
});

describe("tasks and their notes", () => {
  before(async () => {
    await openVault({ demo: false, time: NOW, notes: { "cards/Project.md": "---\ntags: [work]\ncategory: Proj\n---\nAbout the project.\n", "cards/Other.md": "Other.\n" } });
  });

  test("a task captured for a note links to it; the note gets an id once", async () => {
    const rec = await ev(async () => (await addTask({ title: "Plan it", sched: "<2026-10-30 Fri>" }, { notePath: "cards/Project.md" })));
    const note = await raw("cards/Project.md");
    const id = /^id: (\S+)$/m.exec(note)[1];
    assert.equal(rec.note, id);
    await ev(async () => addTask({ title: "Second" }, { notePath: "cards/Project.md" }));
    assert.equal((await raw("cards/Project.md")).match(/^id:/gm).length, 1);
    const e = await ev(() => orgAll().find((x) => x.title === "Plan it"));
    assert.equal(e.category, "Proj");
    assert.deepEqual(e.alltags, ["work"]);
  });

  test("a task outlives its note, and works again when the note is back", async () => {
    const before = await raw("cards/Project.md");
    await ev(async () => { await txn("del", () => removeNote("cards/Project.md")); });
    let e = await ev(() => orgAll().find((x) => x.title === "Plan it"));
    assert.ok(e, "the task stays");
    assert.equal(e.path, null);
    assert.equal(e.noteGone, true);
    assert.equal(e.category, "Note deleted");
    await ev((t) => txn("back", () => writeRaw("cards/Restored name.md", t)), before);
    e = await ev(() => orgAll().find((x) => x.title === "Plan it"));
    assert.equal(e.path, "cards/Restored name.md", "the id finds the note under its new name");
  });

  test("relinking, renaming and deleting are undoable changes of the file", async () => {
    const id = await ev(() => orgAll().find((x) => x.title === "Plan it").id);
    await ev((id) => linkTask(id, "cards/Other.md"), id);
    assert.match(await raw("cards/Other.md"), /^---\nid: \S+\n---\nOther\.\n$/);
    assert.equal(await ev((id) => orgAll().find((x) => x.id === id).path, id), "cards/Other.md");
    await ev((id) => editTask(id, (r) => { r.title = "Renamed"; return "renamed"; }), id);
    assert.ok((await tasksFile()).includes('"title":"Renamed"'));
    await ev((id) => deleteTask(id), id);
    assert.ok(!(await tasksFile()).includes("Renamed"));
    await ev(() => undo());
    assert.ok((await tasksFile()).includes("Renamed"), "undo brings it back");
  });

  test("the file changed on disk (a sync) is read again", async () => {
    await ev(async () => {
      const t = await vault.fs.read(".supstack/tasks.jsonl");
      vault.fs.files.set(".supstack/tasks.jsonl", { data: t + '{"id":"zz","state":" ","title":"From the other device"}\n', mtime: Date.now() });
    });
    assert.equal(await ev(() => reloadTasks()), true);
    assert.ok(await ev(() => orgAll().some((x) => x.title === "From the other device")));
  });

  test("archiving moves the tasks closed before today to the archive file", async () => {
    await ev(async () => {
      await addTask({ title: "Done long ago", state: "x", closed: "[2026-10-01 Thu 10:00]" });
      await addTask({ title: "Done today", state: "x", closed: "[2026-10-29 Thu 09:00]" });
    });
    assert.equal(await ev(() => archiveClosed(1)), 1);
    assert.ok((await fsText(".supstack/tasks-archive.jsonl")).includes("Done long ago"));
    const titles = await ev(() => orgAll().map((x) => x.title));
    assert.ok(!titles.includes("Done long ago") && titles.includes("Done today"));
  });
});

describe("the agenda and the notes' boxes", () => {
  before(async () => {
    await openVault({ demo: false, time: NOW, notes: { "cards/List.md": "---\nid: list\n---\n- [ ] milk\n- [x] bread\n" } });
    await ev(async () => { await addTask({ title: "Agenda task", sched: "<2026-10-29 Thu>" }, { notePath: "cards/List.md" }); });
  });

  test("a box in a note is a checklist: not in the agenda, ticked without a CLOSED: line", async () => {
    const titles = await ev(() => orgAll().map((x) => x.title));
    assert.deepEqual(titles, ["Agenda task"]);
    assert.deepEqual(await ev(() => cardTaskProgress("cards/List.md")), { done: 1, n: 2 });
    await ev(() => toggleTask("cards/List.md", 0));
    assert.equal(await raw("cards/List.md"), "---\nid: list\n---\n- [x] milk\n- [x] bread\n");
  });

  test("ticking a task in the agenda changes the file, not the note", async () => {
    await ev(() => openTasksView());
    await settle();
    const note = await raw("cards/List.md");
    await H.page.click(".ag-row .task-box");
    await tick(200);
    const rec = (await records()).find((x) => x.title === "Agenda task");
    assert.equal(rec.state, "x");
    assert.match(rec.closed, /^\[2026-10-29 Thu 10:00\]$/);
    assert.equal(await raw("cards/List.md"), note);
    assert.equal(await H.page.locator(".ag-row .ag-cat").first().textContent(), "List");
  });

  test("capture makes a task with no note, or one linked to a note found by its name", async () => {
    await ev(() => orgCapture({ head: "Buy stamps" }));
    await H.page.fill(".cap-when", "fri 11:00");
    await H.page.click(".ag-cap .is-primary");
    await tick(200);
    const rec = (await records()).find((x) => x.title === "Buy stamps");
    assert.equal(rec.sched, "<2026-10-30 Fri 11:00>");
    assert.equal(rec.note, undefined);
    // typing part of a name lists the matching notes; Enter takes the first, then the date
    await ev(() => orgCapture({ head: "Standup" }));
    await H.page.fill(".cap-note", "lis");
    assert.deepEqual(await ev(() => [...document.querySelectorAll(".cap-note-list .suggestion-title")].map((x) => x.textContent)).then((a) => a.includes("List")), true);
    await H.page.press(".cap-note", "Enter");
    assert.equal(await H.page.inputValue(".cap-note"), "List");
    assert.equal(await ev(() => document.activeElement.classList.contains("cap-when")), true, "on to the date");
    await H.page.fill(".cap-when", "fri 9:30");
    await H.page.click(".ag-cap .is-primary");
    await tick(200);
    const m = (await records()).find((x) => x.title === "Standup");
    assert.deepEqual([m.state, m.sched, m.note], [" ", "<2026-10-30 Fri 09:30>", "list"]);
    // a name no note has keeps the form open; Esc closes the list first, then the form
    await ev(() => orgCapture({ head: "Nowhere" }));
    await H.page.fill(".cap-note", "zzzqqq");
    await H.page.click(".ag-cap .is-primary");
    await tick(100);
    assert.equal(await ev(() => !!document.querySelector(".ag-cap")), true);
    assert.match(await H.page.textContent(".ag-cap"), /No note by that name/);
    await H.page.fill(".cap-note", "lis");
    await H.page.keyboard.press("Escape");
    assert.deepEqual(await ev(() => [!!document.querySelector(".ag-cap"), document.querySelector(".cap-note-list").hidden]), [true, true]);
    await H.page.keyboard.press("Escape");
    assert.equal(await ev(() => !!document.querySelector(".ag-cap")), false);
    // opened for a note, the field already names it
    await ev(() => orgCapture({ head: "Prefilled", link: "cards/List.md" }));
    assert.equal(await H.page.inputValue(".cap-note"), "List");
    await H.page.keyboard.press("Escape");
  });

  test("the calendar export and the reminders read the tasks file", async () => {
    const ics = await ev(() => tasksToIcs(orgAll(), { now: new Date("2026-10-29T10:00:00Z") }).text);
    assert.match(ics, /SUMMARY:Buy stamps/);
    assert.match(ics, /SUMMARY:Standup/);
    const rem = await ev(() => upcomingReminders(orgAll(), Date.now()).map((r) => r.title));
    assert.deepEqual(rem.sort(), ["Buy stamps", "Standup"], "a task with a time reminds");
  });
});
