// Type sizes and the list's rows (spec §5.5).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
/**
 * The font sizes of the text on screen, with where each is used. The note's own title and headings are left out:
 * they follow the note's type (40px title, then 28, 24, 20), not the interface's six sizes; so is the agenda's title,
 * set at the page's size like a note's (restyle RS-79).
 */
const sizes = () => ev(() => {
  const out = {};
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || (el.matches("input, textarea") && (el.value || el.placeholder));
    if (!own) continue;
    const r = el.getBoundingClientRect(), c = getComputedStyle(el);
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || c.visibility === "hidden" || parseFloat(c.opacity) < 0.05) continue;
    if (el.matches(".sn-inline-title, .ag-head.is-page .ag-title b") || el.closest(".markdown-rendered :is(h1, h2, h3, h4, h5, h6), .cm-sn-h")) continue;
    const fs = parseFloat(c.fontSize);
    if (!fs) continue;
    (out[fs] ||= []).push(el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + (el.closest("kbd") ? " (kbd)" : ""));
  }
  return out;
});
const SCALE = [12, 13, 14, 16, 20, 24];

describe("six sizes of type (UI-20, UI-21)", () => {
  const screens = [
    ["the list and a note being read", { viewport: { width: 1280, height: 900 } }, () => openEditor("cards/This week.md", { focus: false, wide: false })],
    ["a note being edited", { viewport: { width: 1280, height: 900 } }, () => openEditor("cards/This week.md", { focus: false, edit: true, wide: false })],
    ["the agenda", { viewport: { width: 1280, height: 1200 } }, () => { closeEditor(true); openTasksView(true, "agenda"); }],
    ["the task list", { viewport: { width: 1280, height: 900 } }, () => { closeEditor(true); openTasksView(true, "todo"); }],
    ["a phone's list", { viewport: { width: 412, height: 915 }, touch: true }, () => closeEditor(true)],
    ["a phone's agenda", { viewport: { width: 412, height: 915 }, touch: true }, () => { closeEditor(true); openTasksView(true, "agenda"); }],
  ];
  for (const [name, o, act] of screens) {
    test(`${name}: only 12, 13, 14, 16, 20 and 24px; 11px only for keys`, async () => {
      await openVault({ ...o, openNotes: "read" });
      await ev(act);
      await settle();
      const s = await sizes();
      const off = Object.entries(s).filter(([fs, els]) => !SCALE.includes(+fs) && !(+fs === 11 && els.every((x) => x.endsWith("(kbd)"))));
      assert.deepEqual(off.map(([fs, els]) => `${fs}px: ${[...new Set(els)].slice(0, 4).join(", ")}`), []);
      noErrors();
    });
  }

  test("the note's own type: a 40px title, then 28, 24 and 20px headings", async () => {
    await openVault({ demo: false, openNotes: "read", notes: { "cards/N.md": "# One\n\n## Two\n\n### Three\n\n#### Four\n\nText\n" } });
    await ev(() => openEditor("cards/N.md", { focus: false, wide: false }));
    await settle();
    assert.deepEqual(await ev(() => [".sn-inline-title", "h1", "h2", "h3", "h4", "p"].map((s) => getComputedStyle(document.querySelector("#editor " + (s.startsWith(".") ? s : ".sn-reading " + s))).fontSize)),
      ["40px", "28px", "24px", "20px", "16px", "16px"]);
  });
});

describe("a row of the list (UI-22, UI-23)", () => {
  test("the title first, then the text, then one line with the date, the tasks and the tags", async () => {
    await openVault({ viewport: { width: 1280, height: 900 } });
    const rows = await ev(() => [...document.querySelectorAll("#board .sn-row:not(.is-folder)")].map((r) => {
      const top = (s) => r.querySelector(s)?.getBoundingClientRect().top ?? null;
      const meta = r.querySelector(".sn-row-meta");
      return { title: r.querySelector(".sn-row-title").textContent, order: [top(".sn-row-title") < top(".sn-row-snippet"), top(".sn-row-snippet") < top(".sn-row-meta")],
        line: [...meta.children].map((c) => c.className.split(" ").pop()), oneLine: meta.scrollHeight <= meta.clientHeight + 1 };
    }));
    for (const r of rows) assert.deepEqual([r.order, r.oneLine], [[true, true], true], JSON.stringify(r));
    assert.deepEqual(rows.find((r) => r.title === "This week").line, ["sn-row-date", "sn-task-prog", "sn-row-tags"]);
  });

  test("a row picked has the padding and the height it had", async () => {
    await openVault({ viewport: { width: 1280, height: 900 } });
    const row = () => ev(() => { const r = document.querySelector('#board .sn-row[data-path="cards/Templates/Book.md"]'), c = getComputedStyle(r); return { picked: r.classList.contains("is-editing"), h: Math.round(r.getBoundingClientRect().height * 10) / 10, pad: c.padding, border: c.borderTopWidth }; });
    const before = await row();
    await ev(() => openEditor("cards/Templates/Book.md", { focus: false, wide: false }));
    await settle();
    const after = await row();
    assert.deepEqual([before.picked, after.picked], [false, true]);
    assert.deepEqual({ ...after, picked: 0 }, { ...before, picked: 0 });
  });
});

describe("the tree's counts (UI-24)", () => {
  test("All notes says its number is every note on all levels; a notebook's, what is right inside it", async () => {
    for (const [lang, all, inside] of [["en", "16 notes on all levels", "1 note or notebook right inside"], ["ru", "16 заметок на всех уровнях", "1 заметка или блокнот прямо внутри"]]) {
      await openVault({ lang });
      const r = await ev(() => { const rows = [...document.querySelectorAll("#tree .sn-tree-row")]; return [rows[0].querySelector(".sn-tree-count").title, rows.find((x) => x.dataset.path === "cards/History.md").querySelector(".sn-tree-count").title]; });
      assert.deepEqual(r, [all, inside], lang);
    }
  });
});
