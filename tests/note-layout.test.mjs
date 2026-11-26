// The open note's details (spec §5.2): a box's lines under its text, the same place for every line reading and editing,
// the formatting bar's edge, and the mentions under the text.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
// a note's boxes are a checklist (open or done); the agenda's tasks are in .supstack/tasks.jsonl
const BOXES = "- [ ] Book the tour :travel:\n  Call the visitor centre first.\n- [x] Pay the deposit\n  Paid by card.\n";
const KEEP = { ".supstack/tasks.jsonl": "" };

describe("a box's lines in the reading view (UI-5)", () => {
  test("the line under a box starts where the box's text starts", async () => {
    await openVault({ demo: false, openNotes: "read", notes: { "cards/Trip.md": BOXES, ...KEEP } });
    await ev(() => openEditor("cards/Trip.md", { focus: false, wide: false }));
    await settle();
    const rows = await ev(() => [...document.querySelectorAll("#editor .sn-reading li.org-entry")].map((li) => {
      const start = (n) => { const r = document.createRange(), i = n.data.search(/\S/); r.setStart(n, i); r.setEnd(n, i + 1); return Math.round(r.getBoundingClientRect().left); };
      let n = li.querySelector(".task-box").nextSibling;
      while (n && n.nodeType === 3 && !n.data.trim()) n = n.nextSibling;
      const note = [...li.querySelector(".org-body").childNodes].find((x) => x.nodeType === 3 && x.data.trim());
      return { text: start(n), note: start(note) };
    }));
    assert.equal(rows.length, 2);
    for (const r of rows) assert.ok(Math.abs(r.note - r.text) <= 1, JSON.stringify(rows));
    noErrors();
  });
});

describe("reading and editing put every line in one place", () => {
  const NOTE = "Packing for the trip #travel\n\n## Packing\n\n- [x] Passport\n- [ ] Camera\n  - [x] Charger\n  - [ ] Spare card #photo\n  Ask Marta about the tripod.\n- [ ] A guidebook\n\n## Ideas\n\nA paragraph.\n\nAnother one.\n\n- Visit at sunrise\n  - [ ] Check opening hours\n\n1. One\n2. Two\n";
  const WORDS = ["Packing for", "Packing", "Passport", "Camera", "Charger", "Spare", "photo", "Ask Marta", "A guidebook", "Ideas", "A paragraph", "Another", "Visit", "Check opening", "One", "Two"];
  // where each piece of text starts on the screen
  const where = () => ev((words) => {
    const root = document.querySelector("#editor .sn-reading"), out = {};
    for (const w of words) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const d = walker.currentNode.data, i = d.indexOf(w);
        if (i < 0 || (w === "Packing" && d.trim() !== w)) continue;
        const r = document.createRange(); r.setStart(walker.currentNode, i); r.setEnd(walker.currentNode, i + 1);
        const b = r.getBoundingClientRect(); out[w] = [Math.round(b.left), Math.round(b.top)]; break;
      }
    }
    return out;
  }, WORDS);
  test("switching to editing moves no line, box, bullet or tag by more than 2px", async () => {
    await openVault({ demo: false, viewport: { width: 1440, height: 900 }, notes: { "cards/Trip.md": NOTE, ...KEEP } });
    await ev(() => openEditor("cards/Trip.md", { focus: false, wide: true }));
    await settle();
    const read = await where();
    await ev(() => openEditor("cards/Trip.md", { focus: false, wide: true, edit: true }));
    await settle();
    const edit = await where();
    for (const w of WORDS) {
      assert.ok(read[w] && edit[w], `${w} found: ${JSON.stringify({ read, edit })}`);
      assert.ok(Math.abs(read[w][0] - edit[w][0]) <= 1 && Math.abs(read[w][1] - edit[w][1]) <= 2, `${w}: read ${read[w]}, edit ${edit[w]}`);
    }
    // a tag is the same chip in both views; only the caret in it brings its Markdown back
    assert.deepEqual(await ev(() => [...document.querySelectorAll("#editor a.tag.cm-sn-tag")].map((a) => a.textContent)), ["travel", "photo"]);
    noErrors();
  });
});

describe("a task's title that wraps in the reading view (UI-5)", () => {
  const LONG = "the long pressure pipes that carried the water across every valley on the way to the town";
  const NOTE = `- [ ] Plain: ${LONG}\n- [ ] Folds: ${LONG}\n  - [ ] Subtask: ${LONG}\n`;
  test("its next lines start where its text starts; boxes of a list stand in one column, and a subtask's is a step right of its parent's", async () => {
    await openVault({ demo: false, openNotes: "read", viewport: { width: 412, height: 900 }, touch: true, notes: { "cards/Pipes.md": NOTE, ...KEEP } });
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
    // a box that folds hangs its chevron in the margin (on a phone, at its line's end): boxes stand in one column (#18)
    assert.equal(by.Plain.box, by.Folds.box, `boxes in one column: ${JSON.stringify(rows)}`);
    // the subtask's box sits under its parent's text, not left of the parent's box
    assert.ok(by.Subtask.box - by.Subtask.parentBox >= 16, `a subtask nests right of its parent: ${JSON.stringify(by.Subtask)}`);
    assert.ok(Math.abs(by.Subtask.box - by.Folds.lines[0]) <= 4, `a subtask's box under its parent's text: ${JSON.stringify(rows)}`);
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
