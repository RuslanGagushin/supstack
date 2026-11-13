// Windows between a phone and a wide desktop (spec UI-1, UI-2, UI-3): the note beside the list keeps its room.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
/** Widths of what is on screen: the sidebar (0 when closed), the note, its text; and how the sidebar and the note sit. */
const measure = () => ev(() => {
  const app = document.querySelector("#app"), side = document.querySelector(".sn-side"), ed = document.querySelector("#editor");
  const text = document.querySelector("#editor .sn-reading, #editor .cm-content");
  const back = document.querySelector("#editor a.sn-editor-back");
  return {
    sideOpen: !app.classList.contains("side-closed"), sideOver: getComputedStyle(side).position === "fixed",
    note: Math.round(ed.getBoundingClientRect().width), noteLeft: Math.round(ed.getBoundingClientRect().left),
    text: text ? Math.round(text.getBoundingClientRect().width) : 0, back: !!back && getComputedStyle(back).display !== "none",
    hScroll: document.documentElement.scrollWidth > innerWidth, saved: JSON.parse(localStorage.getItem("sn-ui") || "{}").sideOpen,
  };
});
const resize = async (width) => { await page().setViewportSize({ width, height: 800 }); await settle(); await settle(); };
const openNote = async () => { await ev(() => openEditor("cards/This week.md", { focus: false, wide: false })); await settle(); };

describe("the note beside the list (UI-1)", () => {
  test("at 1280, 1100, 1024, 900 and 830 the note is at least 480px wide and its text at least 400px", async () => {
    for (const width of [1280, 1100, 1024, 900, 830]) {
      await openVault({ viewport: { width, height: 800 }, openNotes: "read" });
      await openNote();
      const m = await measure();
      assert.ok(m.note >= 480 && m.text >= 400 && !m.hScroll, `${width}: ${JSON.stringify(m)}`);
    }
    noErrors();
  });

  test("a wide list gives way to the note, down to 260px", async () => {
    await openVault({ viewport: { width: 1300, height: 800 }, openNotes: "read" });
    await ev(() => document.documentElement.style.setProperty("--list-w", "640px"));
    await openNote();
    const m = await measure();
    assert.ok(m.note >= 480, JSON.stringify(m));
    assert.equal(await ev(() => Math.round(document.querySelector("#board").getBoundingClientRect().width)), 1300 - 280 - 500);
  });
});

describe("the sidebar under 1180px (UI-2)", () => {
  test("opening a note folds it away without changing the setting; a wider window brings it back", async () => {
    await openVault({ viewport: { width: 1100, height: 800 }, openNotes: "read" });
    assert.equal((await measure()).sideOpen, false, "the first note opens with the vault, so it is folded at once");
    await ev(() => closeEditor());
    await settle();
    assert.equal((await measure()).sideOpen, true, "no note open: it is back");
    await openNote();
    assert.deepEqual([(await measure()).sideOpen, (await ev(() => UI.sideOpen))], [false, true]);
    await resize(1300);
    assert.equal((await measure()).sideOpen, true);
    await resize(1100);
    assert.equal((await measure()).sideOpen, false);
    await ev(() => closeEditor());
    await settle();
    assert.equal((await measure()).sideOpen, true, "the note closed: it comes back");
    noErrors();
  });

  test("opened by hand it lies over the page and stays while other notes open, until the window changes width", async () => {
    await openVault({ viewport: { width: 1100, height: 800 }, openNotes: "read" });
    await openNote();
    await ev(() => setSide(true));
    await settle();
    let m = await measure();
    assert.deepEqual([m.sideOpen, m.sideOver], [true, true]);
    assert.ok(m.note >= 480, "the note keeps its room under the drawer");
    await ev(() => openEditor("cards/Draft thoughts.md", { focus: false, wide: false }));
    await settle();
    assert.equal((await measure()).sideOpen, true, "kept while notes change");
    await resize(1050);
    assert.equal((await measure()).sideOpen, false, "another width folds it again");
    await ev(() => setSide(true));
    await settle();
    await page().click(".sn-side-scrim", { position: { x: 1000, y: 400 } });
    await settle();
    m = await measure();
    assert.deepEqual([m.sideOpen, await ev(() => UI.sideOpen)], [false, true], "the grey around it closes it, the setting stays");
    await resize(1400);
    assert.equal((await measure()).sideOpen, true);
    noErrors();
  });
});

describe("the note over the list under 960px (UI-3)", () => {
  test("the note covers the list with ‹ its notebook, which goes back to the list", async () => {
    await openVault({ viewport: { width: 900, height: 800 }, openNotes: "read" });
    await ev(() => setTarget("cards/Roman Empire.md"));
    await ev(() => openEditor("cards/Colosseum.md", { focus: false, wide: false }));
    await settle();
    const m = await measure();
    assert.deepEqual([m.note, m.noteLeft, m.back], [900, 0, true]);
    assert.equal(await ev(() => document.querySelector("#editor a.sn-editor-back").textContent.trim()), "Roman Empire");
    await page().click("#editor a.sn-editor-back");
    await settle();
    assert.deepEqual(await ev(() => [editor.path, board.target]), [null, "cards/Roman Empire.md"]);
    await resize(1000);
    await openNote();
    assert.equal((await measure()).back, false, "at 960 and over, the note is beside the list again");
    noErrors();
  });
});
