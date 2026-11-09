// Tags: suggestions under the Properties panel's tag input, and the "Add tag…" command (Ctrl+Shift+T, card menu).
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
  beforeEach(async () => { await openVault({ demo: false, notes: NOTES }); await ev(() => openEditor("cards/Note.md")); await settle(); await page().click("#editor-props .sn-props-head"); });

  test("the tag input in Properties suggests the vault's tags, most used first, and leaves out the note's own", async () => {
    await page().click("#editor-props .sn-prop-input");
    const rows = await page().$$eval(".ac-pop .ac-title", (els) => els.map((e) => e.textContent));
    assert.deepEqual(rows, ["#project", "#home", "#reading"]);
    await page().keyboard.type("rea");
    assert.deepEqual(await page().$$eval(".ac-pop .ac-title", (els) => els.map((e) => e.textContent)), ["#reading", "#rea"]);
    await page().keyboard.press("Enter");
    await settle();
    assert.match(await raw("cards/Note.md"), /tags:\n  - garden\n  - reading\n/);
    // the input keeps focus for the next tag; a comma or a space adds what is typed
    await page().keyboard.type("Big idea,");
    await settle();
    assert.match(await raw("cards/Note.md"), /  - reading\n  - Big\n  - idea\n/);
  });

  test("Backspace in the empty tag input removes the last tag", async () => {
    await page().click("#editor-props .sn-prop-input");
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
