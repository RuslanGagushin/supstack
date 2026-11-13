// Around the notes: the palettes, settings, language and themes, the app's frame, git sync settings and the phone layout.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

describe("palettes, settings, language and themes", () => {
  beforeEach(() => openVault());

  test("Ctrl+O opens a card by fuzzy name", async () => {
    await page().keyboard.press("Control+o");
    await page().keyboard.type("pont");
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.target), "cards/Pont du Gard.md");
  });

  test("the command palette runs a command", async () => {
    await page().keyboard.press("Control+p");
    await page().keyboard.type("files");
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.view), "files");
  });

  test("settings and keyboard shortcuts open without errors", async () => {
    await ev(() => settingsModal("board"));
    assert.match(await page().textContent(".modal"), /Default sort/);
    await page().keyboard.press("Escape");
    await ev(() => hotkeysModal());
    assert.match(await page().textContent(".modal"), /All files in the vault/);
    noErrors();
  });

  test("settings list their sections on the side, arrow keys move between them, the last one is remembered and the search finds rows", async () => {
    await ev(() => settingsModal("appearance"));
    const tabs = () => page().$$eval(".sn-set-tab", (b) => b.map((x) => [x.textContent, x.getAttribute("aria-selected")]));
    assert.deepEqual((await tabs()).map((x) => x[0]), ["Appearance", "Keyboard shortcuts", "About"], "no Git section outside the app; the board's options are in Appearance");
    assert.match(await page().textContent(".sn-set-body"), /Theme/);
    assert.match(await page().textContent(".sn-set-body"), /Default sort/, "the interface and the board's defaults in one section");
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /Parents field/, "one group at a time");
    const height = await page().$eval(".modal", (m) => m.offsetHeight);
    await page().click(".sn-set-tab:has-text('Keyboard shortcuts')");
    assert.equal(await page().$eval(".modal", (m) => m.offsetHeight), height, "the dialog keeps its size between tabs");
    await page().click(".sn-set-tab:has-text('Appearance')");
    await page().focus(".sn-set-tab.is-active");
    await page().keyboard.press("ArrowDown");
    assert.equal((await tabs()).find((x) => x[1] === "true")[0], "Keyboard shortcuts");
    await page().keyboard.press("ArrowDown");
    assert.equal((await tabs()).find((x) => x[1] === "true")[0], "About");
    await page().keyboard.press("Escape");
    await ev(() => settingsModal());
    assert.equal(await page().textContent(".sn-set-tab.is-active"), "About");
    await ev(() => settingsModal("about")); // already open: switches tabs instead of stacking a second dialog
    assert.equal(await page().$$eval(".modal", (m) => m.length), 1);
    await page().fill(".sn-set-search", "maximum");
    assert.match(await page().textContent(".sn-set-body"), /Maximum notes in a list/, "the search looks through every section");
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /Theme/);
    noErrors();
  });

  test("About shows the version; the web page has nothing to update", async () => {
    await ev(() => settingsModal("about"));
    const body = await page().textContent(".sn-set-body");
    assert.match(body, /Supstack/);
    assert.match(body, new RegExp("Version " + (await ev(() => APP_VERSION)).replace(/\./g, "\\.") + " · web page"));
    assert.match(body, /Release notes/);
    assert.doesNotMatch(body, /Check now/, "no update check in the browser");
    assert.deepEqual(await ev(() => [isNewer("0.8.0", "0.7.1"), isNewer("v0.7.10", "0.7.9"), isNewer("1.0.0", "1.0.0"), isNewer("0.7.1", "0.8.0"), isNewer("1.0", "0.9.9")]), [true, true, false, false, true]);
    noErrors();
  });

  test("theme toggle switches to dark", async () => {
    const before = await ev(() => document.body.classList.contains("theme-dark"));
    await ev((before) => { UI.theme = before ? "light" : "dark"; applyTheme(); }, before);
    assert.equal(await ev(() => document.body.classList.contains("theme-dark")), !before);
  });

  test("the Russian interface", async () => {
    await openVault({ lang: "ru" });
    assert.match(await page().textContent(".sn-list-title"), /Все заметки/);
    assert.match(await page().textContent("#files-btn"), /Файлы/);
    noErrors();
  });
});

describe("no top bar", () => {
  test("the agenda, Files and settings are in the sidebar; a view's own bar opens the sidebar when it is closed", async () => {
    await openVault({ viewport: { width: 1280, height: 800 } });
    assert.equal(await ev(() => !!$(".wb-top")), false, "no top bar");
    assert.deepEqual(await ev(() => ["#tasks-btn", "#files-btn"].map((s) => !!$(s)?.closest(".sn-side .sb-nav"))), [true, true]);
    assert.equal(await ev(() => !!$(".sn-side .sb-foot [aria-label='" + t("settings") + "']")), true, "settings at the sidebar's foot");
    const toggleShown = () => ev(() => { const b = $(".sn-board .sn-side-toggle"); return !!b && getComputedStyle(b).display !== "none"; });
    assert.equal(await toggleShown(), false, "no opener while the sidebar is open");
    await page().click(".sb-collapse");
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
    assert.equal(await toggleShown(), true);
    await page().click(".sn-board .sn-side-toggle");
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), false);
    noErrors();
  });
});

describe("the app", () => {
  test("starts in its last folder with the native parts on screen, without errors (0.21.0 showed a white screen)", async () => {
    await H.openNativeApp();
    assert.equal(await ev(() => !!window.__TAURI__ && SupstackApp.vault.fs.kind === "disk" && typeof keyText === "undefined"), true, "a native vault, and the exports are not globals");
    assert.ok(await page().isVisible(".wb-files"), "the Files button");
    assert.match(await page().textContent(".sn-board"), /Home/);
    await page().keyboard.press("Control+p");
    await page().waitForSelector(".prompt .prompt-input");
    noErrors();
  });
});

describe("git sync settings", () => {
  test("the access token is handed to the native side and never kept in the page's storage", async () => {
    const old = { remote: "https://example.com/notes.git", branch: "main", username: "git", token: "tok", authorName: "", authorEmail: "", auto: false, minutes: 5 };
    await H.openNativeApp({ storage: { "sn-git:/vault": old } });
    await page().waitForFunction(() => window.__invokes.some(([c]) => c === "plugin:vault|git_save_settings"));
    const saved = await ev(() => window.__invokes.find(([c]) => c === "plugin:vault|git_save_settings")[1].settings);
    assert.equal(saved.token, "tok", "the token an older version kept in the page moves to the repository's settings");
    const local = await ev(() => JSON.parse(localStorage.getItem("sn-git:/vault")));
    assert.equal(local.token, "", "and leaves the page's storage");
    assert.equal(local.remote, old.remote);
    noErrors();
  });
});

describe("phone layout", () => {
  beforeEach(() => openVault({ viewport: { width: 390, height: 800 } }));

  test("the board's toolbar fits a 360px phone, with no depth switch", async () => {
    await page().setViewportSize({ width: 360, height: 760 });
    const r = await ev(() => { setTarget("cards/History.md"); return { right: $(".sn-tools").getBoundingClientRect().right, segs: document.querySelectorAll(".sn-tools .sn-seg").length }; });
    assert.ok(r.right <= 360, `the tools end at ${r.right}px`);
    assert.equal(r.segs, 0, "no depth switch");
    noErrors();
  });

  test("the sidebar starts closed and the editor fills the screen", async () => {
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
    await ev(() => openEditor("cards/History.md"));
    const box = await page().locator("#editor").boundingBox();
    assert.ok(box.width >= 370, `editor width ${box.width}`);
    noErrors();
  });

  test("the note's text uses the editor's width, not the desktop margins", async () => {
    await ev(() => openEditor("cards/History.md"));
    const pad = await ev(() => { const s = getComputedStyle($(".sn-editor-page")); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight)]; });
    assert.ok(pad.every((p) => p <= 16), `side padding ${pad}`);
    const box = await page().locator(".sn-editor-page .cm-content").boundingBox();
    assert.ok(box.width >= 330, `text width ${box.width}`);
  });

  test("the sidebar opens as a drawer and closes on navigation", async () => {
    await ev(() => setSide(true));
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), false);
    await ev(() => setTarget("cards/History.md"));
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
  });

  test("on a touch screen a table's + buttons stay under it and on its right, not piled up in a corner", async () => {
    await openVault({ demo: false, notes: { "cards/T.md": "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |" }, viewport: { width: 390, height: 800 }, touch: true });
    await ev(() => openEditor("cards/T.md", { focus: false }));
    await page().waitForSelector("#editor .sn-table-host");
    const r = await ev(() => {
      const box = (s) => $(`#editor ${s}`).getBoundingClientRect();
      return { coarse: matchMedia("(pointer: coarse)").matches, t: box(".sn-live table").toJSON(), row: box(".sn-table-add-row").toJSON(), col: box(".sn-table-add-col").toJSON() };
    });
    assert.ok(r.coarse, "the phone's hit areas apply");
    assert.ok(r.row.top >= r.t.bottom - 1 && r.row.width >= r.t.width - 2, `the row button runs along the bottom: ${JSON.stringify(r)}`);
    assert.ok(r.col.left >= r.t.right - 1 && r.col.height >= r.t.height - 2, `the column button runs along the right: ${JSON.stringify(r)}`);
    noErrors();
  });
});
