// Quick capture from anywhere (spec TASK-5): the desktop app's system-wide shortcut, set from Settings.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openNativeApp, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
/** The shortcuts handed to the app, in order (null: turned off). */
const handed = () => ev(() => window.__invokes.filter(([c]) => c === "set_capture_shortcut").map(([, a]) => a.shortcut));
const open = (o = {}) => openNativeApp({ notes: { "cards/Home.md": "# Home\n" }, expose: true, ...o });
const keysTab = async () => { await ev(() => settingsModal("keys")); await settle(); };

describe("quick capture from anywhere", () => {
  test("the app gets the shortcut at start; when it fires, the capture form opens", async () => {
    await open();
    await page().waitForFunction(() => vault.notes.size > 0);
    assert.deepEqual(await handed(), ["CommandOrControl+Alt+N"]);
    assert.equal(await ev(() => !!document.querySelector(".cap-tpl")), false);
    await ev(() => window.__tauriEmit("quick-capture", null));
    await settle();
    assert.equal(await ev(() => !!document.querySelector(".cap-tpl")), true);
    noErrors();
  });

  test("Settings › Keyboard shortcuts changes it, turns it off and back on", async () => {
    await open();
    await page().waitForFunction(() => vault.notes.size > 0);
    await keysTab();
    const input = page().locator(".mod-settings input[placeholder='CommandOrControl+Alt+N']");
    await input.fill("Ctrl+Shift+J");
    await input.press("Enter");
    await input.blur().catch(() => {});
    await settle();
    assert.deepEqual(await handed(), ["CommandOrControl+Alt+N", "Ctrl+Shift+J"]);
    await page().locator(".mod-settings .checkbox-container").first().click();
    await settle();
    assert.deepEqual((await handed()).slice(-1), [null], "off");
    assert.equal(await ev(() => !!document.querySelector(".mod-settings input[placeholder='CommandOrControl+Alt+N']")), false, "no shortcut field while off");
    await page().locator(".mod-settings .checkbox-container").first().click();
    await settle();
    assert.deepEqual((await handed()).slice(-1), ["Ctrl+Shift+J"], "on again with the keys it had");
    assert.equal(await ev(() => JSON.parse(localStorage.getItem("sn-ui")).captureKey), "Ctrl+Shift+J", "kept for the next start");
    noErrors();
  });

  test("a shortcut the system refuses says why and keeps the one before; off at start means none is set", async () => {
    await open({ answers: { set_capture_shortcut: "!error: HotKey already registered" } });
    await page().waitForFunction(() => vault.notes.size > 0);
    assert.equal(await ev(() => setCaptureKey("Ctrl+Shift+J")), false);
    assert.match(await ev(() => document.querySelector("#toast").textContent), /Can't use (Ctrl\+Shift\+J|⌘⇧J) for quick capture: HotKey already registered/);
    assert.equal(await ev(() => JSON.parse(localStorage.getItem("sn-ui")).captureKey), undefined, "nothing saved");
    await open({ storage: { "sn-ui": { lang: "en", captureKey: "" } } });
    await page().waitForFunction(() => vault.notes.size > 0);
    assert.deepEqual(await handed(), [], "turned off: nothing handed to the app");
    noErrors();
  });
});
