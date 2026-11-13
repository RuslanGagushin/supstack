// Embedded notes (spec LINK-1, LINK-2): ![[Note]] and ![[Note#Heading]] show that note's text in place, in the
// reading view and in the editor, three levels deep at most and never round a cycle.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
/** The embeds in the open note, outermost first: [the note it shows, its text without the head] for each one drawn, and the stopped ones. */
const embeds = () => ev(() => {
  // the text as read: without the fold controls of headings (their "…" shows only when folded)
  const bodyText = (el) => { const c = el.cloneNode(true); c.querySelectorAll(".org-ellipsis, .org-fold").forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
  return {
    drawn: [...document.querySelectorAll("#editor .sn-note-embed")].map((e) => [e.dataset.embedPath.replace(/^cards\/|\.md$/g, ""), bodyText(e.querySelector(".sn-embed-body"))]),
    stopped: [...document.querySelectorAll("#editor .internal-embed.is-embed-stopped")].map((e) => [e.textContent.trim(), e.title]),
  };
});

describe("embedded notes", () => {
  test("![[Note]] shows the note's text in the reading view, under its name, which opens it", async () => {
    await openVault({ openNotes: "read", demo: false, notes: {
      "cards/Trip.md": "Before.\n\n![[Packing]]\n\nAfter.\n",
      "cards/Packing.md": "---\ntags: [list]\n---\nTake a **map**.\n",
    } });
    await ev(() => openEditor("cards/Trip.md", { focus: false }));
    assert.deepEqual(await embeds(), { drawn: [["Packing", "Take a map."]], stopped: [] });
    const r = await ev(() => {
      const e = document.querySelector("#editor .sn-note-embed");
      return { head: e.querySelector(".sn-embed-head").textContent, bold: !!e.querySelector("strong"), around: [e.previousElementSibling?.textContent, e.nextElementSibling?.textContent], inP: !!e.closest("p") };
    });
    assert.deepEqual(r, { head: "Packing", bold: true, around: ["Before.", "After."], inP: false }, "rendered, as a block between the paragraphs, without the frontmatter");
    await page().click("#editor .sn-embed-head a");
    await settle();
    assert.equal(await ev(() => editor.path), "cards/Packing.md");
    noErrors();
  });

  test("![[Note#Heading]] shows that section; a missing note stays a link, a missing heading says so", async () => {
    await openVault({ openNotes: "read", demo: false, notes: {
      "cards/Plan.md": "Inline ![[Days#Day 2]] here.\n\n![[Nowhere]]\n\n![[Days#Day 9]]\n",
      "cards/Days.md": "# Days\n\n## Day 1\n\nWalk.\n\n## Day 2\n\nRest.\n\n## Day 3\n\nFly.\n",
    } });
    await ev(() => openEditor("cards/Plan.md", { focus: false }));
    const r = await embeds();
    assert.deepEqual(r.drawn, [["Days", "Day 2 Rest."]]);
    assert.deepEqual(r.stopped, [["Days#Day 9", "No heading “Day 9” in this note"]]);
    assert.equal(await ev(() => !!document.querySelector('#editor .internal-embed a.is-unresolved[data-href="Nowhere"]')), true);
    // the paragraph the inline embed stood in is split around it
    assert.deepEqual(await ev(() => { const e = document.querySelector("#editor .sn-note-embed"); return [e.previousElementSibling.textContent.trim(), e.nextElementSibling.textContent.trim()]; }), ["Inline", "here."]);
    noErrors();
  });

  test("embeds go three levels deep: the fourth stays a link", async () => {
    await openVault({ openNotes: "read", demo: false, notes: {
      "cards/A.md": "a ![[B]]\n", "cards/B.md": "b ![[C]]\n", "cards/C.md": "c ![[D]]\n", "cards/D.md": "d ![[E]]\n", "cards/E.md": "e\n",
    } });
    await ev(() => openEditor("cards/A.md", { focus: false }));
    const r = await embeds();
    assert.deepEqual(r.drawn.map(([p]) => p), ["B", "C", "D"]);
    assert.deepEqual(r.stopped, [["E", "Embedded more than 3 levels deep: shown as a link"]]);
    noErrors();
  });

  test("an embed that would go round a cycle, or a note embedding itself, stays a link", async () => {
    await openVault({ openNotes: "read", demo: false, notes: { "cards/A.md": "![[B]]\n\n![[A]]\n", "cards/B.md": "b\n\n![[A]]\n" } });
    await ev(() => openEditor("cards/A.md", { focus: false }));
    const r = await embeds();
    assert.deepEqual(r.drawn.map(([p]) => p), ["B"]);
    assert.equal(r.stopped.length, 2, JSON.stringify(r.stopped));
    assert.ok(r.stopped.every(([text, title]) => text === "A" && /circle/.test(title)), JSON.stringify(r.stopped));
    noErrors();
  });

  test("tasks in an embed are shown, and a click on one changes neither note", async () => {
    const notes = { "cards/Week.md": "- [ ] Mine\n\n![[Chores]]\n", "cards/Chores.md": "- [ ] Sweep\n- [x] Dust\n" };
    await openVault({ openNotes: "read", demo: false, notes });
    await ev(() => openEditor("cards/Week.md", { focus: false }));
    assert.equal(await ev(() => document.querySelectorAll("#editor .sn-note-embed .task-box").length), 2);
    await page().click("#editor .sn-note-embed .task-box");
    await settle();
    assert.equal(await raw("cards/Week.md"), notes["cards/Week.md"]);
    assert.equal(await raw("cards/Chores.md"), notes["cards/Chores.md"]);
    noErrors();
  });

  test("the editor shows the embed too, away from the caret", async () => {
    await openVault({ demo: false, notes: { "cards/Trip.md": "First line\n\n![[Packing#Gear]]\n", "cards/Packing.md": "# Gear\n\nBoots.\n\n# Food\n\nBread.\n" } });
    await ev(() => openEditor("cards/Trip.md", { focus: true, edit: true }));
    await ev(() => { const ta = document.querySelector(".sn-editor-text"); ta.setSelectionRange(0, 0); });
    await settle();
    assert.deepEqual((await embeds()).drawn, [["Packing", "Gear Boots."]]);
    noErrors();
  });

  test("an embed is drawn again when the note it shows changes, while reading and while editing", async () => {
    for (const edit of [false, true]) {
      await openVault({ openNotes: "read", demo: false, notes: { "cards/Trip.md": "Top\n\n![[Packing]]\n", "cards/Packing.md": "Old text.\n" } });
      await ev((edit) => openEditor("cards/Trip.md", { focus: false, edit }), edit);
      await settle();
      await ev(() => writeRaw("cards/Packing.md", "New text.\n"));
      await settle();
      assert.deepEqual((await embeds()).drawn, [["Packing", "New text."]], edit ? "editing" : "reading");
    }
    noErrors();
  });
});
