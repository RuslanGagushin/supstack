// The open note's details (spec §5.2): a task's lines under its text, planning words that wrap with their date,
// the formatting bar's edge, and the mentions under the text.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
const TASKS = "- [ ] Book the tour :travel:\n  DEADLINE: <2026-11-14 Sat> SCHEDULED: <2026-11-12 Thu>\n  Call the visitor centre first.\n- [/] [#A] Pay the deposit\n  SCHEDULED: <2026-11-13 Fri 10:00>\n";

describe("a task's lines in the reading view (UI-5)", () => {
  test("its date chips and its note start where its text starts; with a priority, where the priority starts", async () => {
    await openVault({ demo: false, openNotes: "read", notes: { "cards/Trip.md": TASKS } });
    await ev(() => openEditor("cards/Trip.md", { focus: false, wide: false }));
    await settle();
    const rows = await ev(() => [...document.querySelectorAll("#editor .sn-reading li.org-entry")].map((li) => {
      const box = li.querySelector(".task-box");
      let n = box.nextSibling;
      while (n && n.nodeType === 3 && !n.data.trim()) n = n.nextSibling;
      const r = document.createRange();
      if (n.nodeType === 3) { const i = n.data.search(/\S/); r.setStart(n, i); r.setEnd(n, i + 1); } else r.selectNode(n);
      const body = li.querySelector(".org-body");
      const note = [...body.childNodes].find((x) => x.nodeType === 3 && x.data.trim());
      const rn = document.createRange();
      if (note) { const i = note.data.search(/\S/); rn.setStart(note, i); rn.setEnd(note, i + 1); }
      return { text: Math.round(r.getBoundingClientRect().left), chip: Math.round(body.querySelector(".sn-chip").getBoundingClientRect().left), note: note ? Math.round(rn.getBoundingClientRect().left) : null };
    }));
    assert.equal(rows.length, 2);
    for (const r of rows) assert.ok(Math.abs(r.chip - r.text) <= 1 && (r.note == null || Math.abs(r.note - r.text) <= 1), JSON.stringify(rows));
    noErrors();
  });
});

describe("a task's title that wraps in the reading view (UI-5)", () => {
  const LONG = "the long pressure pipes that carried the water across every valley on the way to the town";
  const NOTE = `- [ ] Plain: ${LONG}\n- [ ] Folds: ${LONG}\n  SCHEDULED: <2026-11-12 Thu>\n  - [ ] Subtask: ${LONG}\n`;
  test("its next lines start where its text starts; boxes of a list stand in one column, and a subtask's is a step right of its parent's", async () => {
    await openVault({ demo: false, openNotes: "read", viewport: { width: 412, height: 900 }, touch: true, notes: { "cards/Pipes.md": NOTE } });
    await ev(() => openEditor("cards/Pipes.md", { focus: false }));
    await settle();
    const rows = await ev(() => [...document.querySelectorAll("#editor .sn-reading li.task-list-item")].map((li) => {
      const n = [...li.childNodes].find((x) => x.nodeType === 3 && x.data.trim());
      const r = document.createRange();
      r.setStart(n, n.data.search(/\S/)); r.setEnd(n, n.data.trimEnd().length);
      const lines = [...r.getClientRects()].map((x) => Math.round(x.left));
      const parent = li.parentElement.closest("li.task-list-item");
      const boxOf = (x) => Math.round(x.querySelector(":scope > .task-box, :scope > p > .task-box").getBoundingClientRect().left);
      return { name: n.data.trim().split(":")[0], lines, box: boxOf(li), parentBox: parent ? boxOf(parent) : null };
    }));
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    for (const name of ["Plain", "Folds", "Subtask"]) {
      assert.ok(by[name], `${name} found: ${JSON.stringify(rows)}`); const { lines } = by[name];
      assert.ok(lines.length > 1, `${name} wraps: ${JSON.stringify(rows)}`);
      for (const x of lines.slice(1)) assert.ok(Math.abs(x - lines[0]) <= 1, `${name}: ${JSON.stringify(by[name])}`);
    }
    // a task that folds hangs its chevron before the box, and the plain one beside it keeps that room: one column of boxes (#18)
    assert.equal(by.Plain.box, by.Folds.box, `boxes in one column: ${JSON.stringify(rows)}`);
    // the subtask's box sits under its parent's text, not left of the parent's box
    assert.ok(by.Subtask.box - by.Subtask.parentBox >= 16, `a subtask nests right of its parent: ${JSON.stringify(by.Subtask)}`);
    assert.ok(Math.abs(by.Subtask.box - by.Folds.lines[0]) <= 4, `a subtask's box under its parent's text: ${JSON.stringify(rows)}`);
    noErrors();
  });
});

describe("planning words in the editor on a phone (UI-6)", () => {
  test("a planning word and its date are never split over two lines", async () => {
    await openVault({ demo: false, viewport: { width: 412, height: 900 }, notes: { "cards/Trip.md": TASKS } });
    await ev(() => openEditor("cards/Trip.md", { focus: false, edit: true }));
    await settle();
    // away from the caret each pair is one chip, which never breaks
    const chips = await ev(() => [...document.querySelectorAll("#editor .cm-content .org-date")].map((c) => c.getClientRects().length));
    assert.deepEqual(chips, [1, 1, 1]);
    // with the caret in a pair, that word and its date are the Markdown again and wrap as one; the pair beside it stays a chip
    await ev(() => { const ta = $(".sn-editor-text"); ta.focus(); ta.setSelectionRange(ta.value.indexOf("DEADLINE") + 3); });
    await settle();
    const pairs = await ev(() => [...document.querySelectorAll("#editor .cm-content .org-plan")].map((pl) => {
      const pair = pl.closest(".org-pair"), ts = pair?.querySelector(".org-ts");
      return [pl.textContent, !!pair, ts ? Math.abs(ts.getBoundingClientRect().top - pl.getBoundingClientRect().top) < 6 : false];
    }));
    assert.deepEqual(pairs, [["DEADLINE", true, true]]);
    noErrors();
  });
});

describe("the formatting bar's edge (UI-7)", () => {
  test("its last button is 12px from the note's edge, as in the note's header", async () => {
    for (const width of [1280, 412]) {
      await openVault({ viewport: { width, height: 800 }, notes: { "cards/A.md": "Text\n" }, demo: false });
      await ev(() => openEditor("cards/A.md", { focus: false, edit: true, wide: false }));
      await settle();
      const gaps = await ev(() => {
        const ed = document.querySelector("#editor").getBoundingClientRect().right;
        const gap = (sel) => Math.round(ed - Math.max(...[...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width).map((e) => e.getBoundingClientRect().right)));
        return [gap(".sn-editor-head :is(button, a)"), gap(".sn-ed-toolbar button")];
      });
      assert.deepEqual(gaps, [12, 12], `${width}px`);
    }
  });
});

describe("mentions under the note (UI-8)", () => {
  test("they follow the text 32px below it, without a rule; a note without them keeps room to click into", async () => {
    await openVault({ openNotes: "read", demo: false, notes: { "cards/Colosseum.md": "An amphitheatre.\n", "cards/Rome.md": "See [[Colosseum]].\n", "cards/Alone.md": "Short.\n" } });
    await ev(() => openEditor("cards/Colosseum.md", { focus: false, wide: false }));
    await settle();
    const r = await ev(() => {
      const foot = document.querySelector("#editor .sn-editor-foot"), p = document.querySelector("#editor .sn-reading > p:last-child");
      const cs = getComputedStyle(foot);
      return { gap: Math.round(foot.getBoundingClientRect().top - p.getBoundingClientRect().bottom), rule: cs.borderTopStyle, head: foot.querySelector("h4").textContent };
    });
    assert.deepEqual(r, { gap: 32, rule: "none", head: "Linked mentions · 1" });
    await ev(() => openEditor("cards/Alone.md", { focus: false, wide: false }));
    await settle();
    assert.equal(await ev(() => getComputedStyle(document.querySelector("#editor .sn-reading")).minHeight), "240px");
    noErrors();
  });
});

describe("a heading that folds, on a phone (#19)", () => {
  test("it starts where the text does, its chevron at the line's right end, and it still folds", async () => {
    await openVault({ demo: false, openNotes: "read", viewport: { width: 412, height: 900 }, touch: true, notes: { "cards/Plan.md": "Intro text.\n\n## Trip\n\nFirst part.\n\n## Later\n\nSecond part.\n" } });
    await ev(() => openEditor("cards/Plan.md", { focus: false }));
    await settle();
    const m = await ev(() => {
      const root = document.querySelector("#editor .sn-reading .markdown-rendered") || document.querySelector("#editor .markdown-rendered");
      const r = document.createRange(), leftOf = (el) => { const t = [...el.childNodes].find((x) => x.nodeType === 3 && x.data.trim()); r.selectNodeContents(t); return r.getBoundingClientRect(); };
      const h2 = root.querySelector("h2"), fold = h2.querySelector(".org-fold").getBoundingClientRect(), text = leftOf(h2);
      return { para: Math.round(leftOf(root.querySelector("p")).left), head: Math.round(text.left), foldRight: Math.round(fold.right), headRight: Math.round(h2.getBoundingClientRect().right), centres: Math.round((fold.top + fold.bottom) / 2 - (text.top + text.bottom) / 2) };
    });
    assert.ok(Math.abs(m.head - m.para) <= 1, `heading starts with the text: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.foldRight - m.headRight) <= 1 && Math.abs(m.centres) <= 3, `chevron at the right end of the first line: ${JSON.stringify(m)}`);
    await ev(() => document.querySelector("#editor h2 .org-fold").click());
    await settle();
    assert.equal(await ev(() => [...document.querySelectorAll("#editor p")].find((p) => p.textContent === "First part.")?.closest(".org-hidden") != null || [...document.querySelectorAll("#editor p")].some((p) => p.textContent === "First part." && p.classList.contains("org-hidden"))), true, "the section folds");
    noErrors();
  });
});
