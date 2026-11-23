// Tags: suggestions under the tag input in the note panel's Properties, and the "Add tag…" command (Ctrl+Shift+T, card menu).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const NOTES = {
  "cards/Note.md": "---\ntags: [garden]\n---\nHello\n",
  "cards/A.md": "---\ntags: [project, home]\n---\n",
  "cards/B.md": "Text #project #reading\n",
};

describe("tags", () => {
  // a wide window, so the note's panel (and its Properties) sits beside the note
  beforeEach(async () => { await openVault({ demo: false, notes: NOTES, viewport: { width: 1440, height: 900 } }); await ev(() => openEditor("cards/Note.md", { wide: true })); await settle(); });

  test("the tag input in Properties suggests the vault's tags, most used first, and leaves out the note's own", async () => {
    await page().click("#editor .sn-insp .sn-prop-input");
    const rows = await page().$$eval(".ac-pop .ac-title", (els) => els.map((e) => e.textContent));
    assert.deepEqual(rows, ["project", "home", "reading"]);
    await page().keyboard.type("rea");
    assert.deepEqual(await page().$$eval(".ac-pop .ac-title", (els) => els.map((e) => e.textContent)), ["reading", "rea"]);
    await page().keyboard.press("Enter");
    await settle();
    assert.match(await raw("cards/Note.md"), /tags:\n  - garden\n  - reading\n/);
    // the input keeps focus for the next tag; a comma or a space adds what is typed
    await page().keyboard.type("Big idea,");
    await settle();
    assert.match(await raw("cards/Note.md"), /  - reading\n  - Big\n  - idea\n/);
  });

  test("Backspace in the empty tag input removes the last tag", async () => {
    await page().click("#editor .sn-insp .sn-prop-input");
    await page().keyboard.press("Backspace");
    await settle();
    assert.doesNotMatch(await raw("cards/Note.md"), /tags/);
  });

  test("Ctrl+Shift+T picks a tag for the open note; on the board it tags the selection", async () => {
    await page().click(".sn-editor-text, .cm-content");
    await page().keyboard.press("Control+Shift+t");
    await page().waitForSelector(".prompt-input");
    await page().keyboard.type("home");
    await page().keyboard.press("Enter");
    await settle();
    assert.match(await raw("cards/Note.md"), /  - garden\n  - home\n/);
    await ev(() => { closeEditor(); board.selection.add("cards/A.md"); board.selection.add("cards/B.md"); renderBoard(); });
    await page().locator("body").press("Control+Shift+t");
    await page().waitForSelector(".prompt-input");
    await page().keyboard.type("Later");
    await page().keyboard.press("Enter");
    await settle();
    assert.match(await raw("cards/A.md"), /tags:\n  - project\n  - home\n  - Later\n/);
    assert.match(await raw("cards/B.md"), /^---\ntags:\n  - Later\n---\nText #project/);
    assert.deepEqual(H.errors, []);
  });
});

describe("a tag reads the same everywhere (#27)", () => {
  test("in the note's text, a task's chip, the panel and a tag's list it is shown without #", async () => {
    await openVault({ demo: false, viewport: { width: 1440, height: 900 }, openNotes: "read", notes: { "cards/Trip.md": "---\ntags: [travel]\n---\nSee #rome there.\n\n- [ ] Pack :travel:\n  SCHEDULED: <2026-11-12 Thu>\n" } });
    await ev(() => { openEditor("cards/Trip.md", { focus: false }); if (!document.querySelector(".sn-insp")) toggleInspector(); });
    await H.page.waitForTimeout(300);
    const shown = await ev(() => ({
      text: [...document.querySelectorAll("#editor .markdown-rendered a.tag")].map((a) => a.textContent),
      panel: [...document.querySelectorAll("#editor .sn-insp .sn-chip")].map((c) => c.textContent.trim()).filter(Boolean),
    }));
    assert.ok(shown.text.includes("rome") && shown.text.every((x) => !x.startsWith("#")), JSON.stringify(shown));
    assert.ok(shown.panel.every((x) => !x.startsWith("#")), JSON.stringify(shown));
    await ev(() => openTagView("travel"));
    await H.page.waitForTimeout(200);
    assert.equal(await ev(() => document.querySelector("#board .sn-list-title").textContent), "travel");
  });
});
