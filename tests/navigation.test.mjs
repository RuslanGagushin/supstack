// Getting around (spec §5.6): the sidebar's head, the list's new-note field, the palette, the shortcuts, empty Files.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
const visible = (sel) => ev((sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none" && !e.hidden && e.getBoundingClientRect().height > 0), sel);

describe("the sidebar's head (UI-25, UI-27)", () => {
  test("the vault heads it, then three controls, each with its name: Go to note…, New note, Today; the palette is in the vault's menu", async () => {
    for (const [lang, names] of [["ru", ["Перейти к заметке…", "Новая заметка", "Сегодня"]], ["en", ["Go to note…", "New note", "Today"]]]) {
      await openVault({ lang });
      const r = await ev(() => [...document.querySelectorAll(".sb-head button")].filter((b) => b.getBoundingClientRect().width)
        .map((b) => (b.classList.contains("sb-account") ? "vault" : (b.querySelector(".wb-label") || b).textContent.trim())));
      assert.deepEqual(r, ["vault", ...names], lang);
    }
    await page().click(".sb-head .sb-search");
    assert.equal(await visible(".prompt"), true, "Go to note… opens the note finder");
    await page().keyboard.press("Escape");
    await page().click(".sb-account");
    await page().click('.menu .menu-item:has-text("Commands…")');
    assert.equal(await ev(() => document.querySelector(".prompt-input")?.placeholder), "Type a command…");
    noErrors();
  });
});

describe("the new-note field (UI-26)", () => {
  test("hidden while searching and in a tag's view, back when they end", async () => {
    await openVault();
    const field = () => visible("#board .sn-composer");
    assert.equal(await field(), true);
    await ev(() => { board.filter = { query: "rome", tags: [], scope: "here" }; board.searchOpen = true; renderBoard(); });
    assert.equal(await field(), false, "searching");
    await ev(() => toggleSearch(false));
    assert.equal(await field(), true);
    await ev(() => openTagView("travel"));
    await settle();
    assert.equal(await field(), false, "a tag's view");
    await ev(() => setTarget(null));
    await settle();
    assert.equal(await field(), true);
  });
});

describe("the shortcuts in Settings (UI-28)", () => {
  test("under headings, an action once even with two shortcuts", async () => {
    await openVault();
    await ev(() => settingsModal("keys"));
    await settle();
    const r = await ev(() => ({
      heads: [...document.querySelectorAll(".mod-settings .sn-set-heading")].map((x) => x.textContent),
      names: [...document.querySelectorAll(".mod-settings .setting-item-name")].map((x) => x.textContent),
      palette: [...document.querySelectorAll(".mod-settings .setting-item")].find((x) => x.textContent.startsWith("Command palette"))?.querySelectorAll(".suggestion-keys").length,
    }));
    assert.deepEqual(r.heads, ["Everywhere", "The list of notes", "A note", "Tasks and the agenda"]);
    assert.equal(r.names.filter((x) => x === "Command palette").length, 1);
    assert.equal(r.palette, 2, "Ctrl P or Alt X, in one row");
    assert.equal(new Set(r.names).size, r.names.length, "no action twice");
  });
});

describe("the command palette (UI-29)", () => {
  test("commands in groups; the four orders are one Sort… command that asks which", async () => {
    await openVault();
    await page().keyboard.press("Control+p");
    await page().waitForSelector(".prompt .prompt-input");
    const r = await ev(() => ({ groups: [...document.querySelectorAll(".suggestion-group")].map((x) => x.textContent), titles: [...document.querySelectorAll(".prompt .suggestion-title")].map((x) => x.textContent) }));
    assert.deepEqual(r.groups, ["Go to", "Tasks", "This note", "The list", "View", "App"]);
    assert.deepEqual(r.titles.filter((x) => /^Sort/.test(x)), ["Sort…"]);
    await page().fill(".prompt-input", "sort");
    await page().keyboard.press("Enter");
    await page().waitForSelector(".prompt .prompt-input[placeholder='Sort…']");
    const orders = await ev(() => [...document.querySelectorAll(".prompt .suggestion-item")].map((x) => [x.querySelector(".suggestion-title").textContent, !!x.querySelector(".suggestion-check")]));
    assert.deepEqual(orders, [["Manually (order field)", true], ["By name", false], ["Recently modified first", false], ["Newest first", false]]);
    await page().fill(".prompt-input", "by name");
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.sort), "name");
    noErrors();
  });
});

describe("Files without files (UI-30)", () => {
  test("only the hint and Add files; with a file, the search, filters and preview are back", async () => {
    await openVault({ demo: false, notes: { "cards/A.md": "Text\n" } });
    await ev(() => { closeEditor(true); openFilesView(); });
    await settle();
    const parts = () => ev(() => Object.fromEntries([".fv-search-row", ".fv-filters", ".fv-total", ".fv-preview", ".fv-empty, .fv-list .sn-empty, .fv-list > *", ".sn-topbar button[title='Add files'], .sn-topbar .sn-btn"].map((s) => [s.split(",")[0], [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0)])));
    assert.deepEqual(await parts(), { ".fv-search-row": false, ".fv-filters": false, ".fv-total": false, ".fv-preview": false, ".fv-empty": true, ".sn-topbar button[title='Add files']": true });
    await ev(() => { vault.fs.add("attachments/a.txt", new Blob(["x"])); vault.allPaths.add("attachments/a.txt"); addAttachment("attachments/a.txt"); fvRenderList(); });
    await settle();
    const p = await parts();
    assert.deepEqual([p[".fv-search-row"], p[".fv-filters"], p[".fv-preview"]], [true, true, true]);
    noErrors();
  });
});
