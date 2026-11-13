// Accessibility (spec §6): the tree and the list as assistive technology sees them, the keyboard through the tree, the list
// and the agenda, and a focus that can always be seen.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
const focused = () => ev(() => {
  const a = document.activeElement;
  return { role: a.getAttribute("role"), name: a.querySelector?.(":scope > .sn-tree-row .sn-tree-label")?.textContent || a.getAttribute("aria-label"), expanded: a.getAttribute("aria-expanded") };
});
/** Whether the focused element shows where it is: an outline or a ring on it, on its row, or on the field around it. */
const ringShown = () => ev(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a.isContentEditable) return true; // a text field shows its caret
  const ring = (el) => { const s = getComputedStyle(el); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none"; };
  if (ring(a) || [...a.children].some((c) => c.matches(".sn-tree-row, .ag-row.sel") && ring(c)) || [...a.querySelectorAll(".ag-row.sel")].some(ring)) return true;
  for (let e = a.parentElement, k = 0; e && k < 3; e = e.parentElement, k++) if (e.matches(".sn-search, .sn-composer") && ring(e)) return true;
  return false;
});
const describeFocus = () => ev(() => { const a = document.activeElement; return a.tagName + "." + [...a.classList].join(".") + " " + (a.getAttribute("aria-label") || a.title || a.textContent.trim().slice(0, 30)); });

describe("roles for assistive technology (A11Y-1)", () => {
  test("the notebooks are a tree of tree items: level, open state and the open notebook said", async () => {
    await openVault();
    await ev(() => closeEditor(true));
    const snap = await page().locator("#tree [role=tree]").first().ariaSnapshot();
    assert.match(snap, /tree "Notebooks"/);
    assert.match(snap, /treeitem "All notes" \[level=1\] \[selected\]/);
    assert.match(snap, /treeitem "History" \[level=1\]/);
    const items = () => ev(() => Object.fromEntries([...document.querySelectorAll("#tree [role=treeitem]")].map((x) => [document.getElementById(x.getAttribute("aria-labelledby"))?.textContent, [x.getAttribute("aria-level"), x.getAttribute("aria-expanded"), x.getAttribute("aria-selected")]])));
    assert.deepEqual((await items()).History, ["1", "false", "false"]);
    await ev(() => setTarget("cards/History.md"));
    await settle();
    assert.deepEqual((await items()).History.slice(2), ["true"], "the open notebook is selected");
    await page().click('#tree [role=treeitem][data-key] .sn-tree-row:has-text("History") .sn-tree-toggle');
    const r = await items();
    assert.deepEqual(r.History, ["1", "true", "true"], "its branch is open");
    assert.deepEqual(r["All notes"].slice(2), ["false"]);
    assert.deepEqual(r["Roman Empire"], ["2", "false", "false"], "a notebook inside it, one level down");
    assert.equal(await ev(() => document.querySelector("#tree [role=treeitem][data-key] [role=group] [role=treeitem]") !== null), true, "children sit in a group");
    noErrors();
  });

  test("the list of notes is a list box of options; the open note and the picked notes are selected", async () => {
    await openVault();
    const state = () => ev(() => {
      const box = document.querySelector("#board [role=listbox]");
      return { name: box.getAttribute("aria-label"), multi: box.getAttribute("aria-multiselectable"), selected: [...box.querySelectorAll("[role=option][aria-selected=true]")].map((x) => x.getAttribute("aria-label")), options: box.querySelectorAll("[role=option]").length };
    });
    await ev(() => { closeEditor(true); setTarget(null); });
    await settle();
    let s = await state();
    assert.equal(s.name, "All notes");
    assert.equal(s.multi, "false");
    assert.ok(s.options > 2);
    assert.deepEqual(s.selected, []);
    await ev(() => openEditor("cards/History.md", { focus: false }));
    s = await state();
    assert.deepEqual(s.selected, ["History"], "the open note");
    await ev(() => closeEditor(true));
    assert.deepEqual((await state()).selected, [], "closed, nothing selected");
    await ev(() => { board.selectMode = true; renderBoard(); toggleSelect("cards/History.md"); toggleSelect("cards/Knowledge.md"); });
    s = await state();
    assert.equal(s.multi, "true");
    assert.deepEqual(s.selected.sort(), ["History", "Knowledge"]);
    await ev(() => openTagView("travel"));
    await settle();
    assert.equal((await state()).name, "#travel");
    noErrors();
  });
});

describe("the keyboard (A11Y-2)", () => {
  test("the tree: one Tab stop, the arrows move, open and close branches, Enter opens a notebook's list", async () => {
    await openVault();
    await ev(() => closeEditor(true));
    assert.equal(await ev(() => [...document.querySelectorAll("#tree [role=tree]")].map((t) => t.querySelectorAll("[role=treeitem][tabindex='0']").length).join()), "1", "one stop per tree");
    await page().focus("#tree [role=treeitem][tabindex='0']");
    assert.equal((await focused()).name, "All notes");
    const steps = [["ArrowDown", "History", "false"], ["ArrowRight", "History", "true"], ["ArrowRight", "Roman Empire", "false"], ["ArrowLeft", "History", "true"], ["ArrowLeft", "History", "false"], ["End", "Knowledge", "false"], ["Home", "All notes", null], ["ArrowDown", "History", "false"], ["ArrowDown", "Architecture", "false"]];
    for (const [key, name, expanded] of steps) {
      await page().keyboard.press(key);
      const f = await focused();
      assert.deepEqual([f.role, f.name, f.expanded], ["treeitem", name, expanded], key);
      assert.equal(await ringShown(), true, `the focus shows after ${key}`);
    }
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.target), "cards/Architecture.md");
    assert.equal((await focused()).name, "Architecture", "the focus stays in the tree when the tree is drawn again");
    noErrors();
  });

  test("the list: the arrows go from note to note; the agenda: n and p, with the chosen row ringed", async () => {
    await openVault();
    await ev(() => { closeEditor(true); setTarget(null); });
    await settle();
    await page().focus("#board .sn-rows [role=option]");
    const first = await ev(() => document.activeElement.getAttribute("aria-label"));
    await page().keyboard.press("ArrowDown");
    const second = await ev(() => document.activeElement.getAttribute("aria-label"));
    assert.notEqual(second, first);
    assert.equal(await ev(() => document.activeElement.getAttribute("role")), "option");
    assert.equal(await ev(() => document.activeElement.classList.contains("is-folder") || document.activeElement.getAttribute("aria-selected") === "true"), true, "the arrows open the note beside");
    await page().keyboard.press("ArrowUp");
    assert.equal(await ev(() => document.activeElement.getAttribute("aria-label")), first);

    await ev(() => openTasksView());
    await settle();
    await page().focus(".ag-body");
    await page().keyboard.press("n");
    const a = await ev(() => document.querySelector(".ag-row.sel")?.dataset.i);
    await page().keyboard.press("n");
    await page().keyboard.press("p");
    assert.equal(await ev(() => document.querySelector(".ag-row.sel")?.dataset.i), a);
    assert.equal(await ev(() => document.querySelector(".ag-row.sel").getAttribute("aria-selected")), "true");
    assert.equal(await ringShown(), true, "the chosen row is ringed while the agenda has the focus");
    noErrors();
  });

  for (const where of ["notes", "agenda"]) {
    test(`every Tab stop shows the focus: ${where}`, async () => {
      await openVault();
      if (where === "agenda") await ev(() => openTasksView());
      await settle();
      await ev(() => document.activeElement?.blur());
      const missing = new Set();
      for (let i = 0; i < 60; i++) {
        await page().keyboard.press("Tab");
        if (!(await ringShown())) missing.add(await describeFocus());
      }
      assert.deepEqual([...missing], []);
      noErrors();
    });
  }
});

// Every kind of date the app draws, for the chips' colours (spec A11Y-3): overdue, due soon, scheduled, done, events,
// inactive timestamps and repeats, and a few notes and tags around them.
const NOW = "2026-11-13T10:00:00";
const DATES = {
  "cards/Work.md": "---\ntags: [work]\n---\n# Work\n\n- [ ] Write report #urgent\n  DEADLINE: <2026-11-10 Tue>\n- [ ] [#A] Ship it\n  DEADLINE: <2026-11-16 Mon>\n- [/] Call Bob\n  SCHEDULED: <2026-11-13 Fri 15:00>\n- [x] Old thing\n  SCHEDULED: <2026-11-01 Sun>\n  CLOSED: [2026-11-01 Sun 09:00]\n- [ ] Run\n  SCHEDULED: <2026-11-14 Sat +1w>\n## Meeting <2026-11-13 Fri 14:00-15:00>\n\nNoted [2026-11-12 Thu] with a [[Notes|link]], ==a highlight== and `code`.\n\n> [!note] A callout\n> with text\n",
  "cards/Notes.md": "---\ntags: [travel]\n---\nSome notes about [[Work]].\n",
};
const VIEWS = {
  note: () => openEditor("cards/Work.md", { focus: false }),
  reading: () => toggleReading(),
  list: () => closeEditor(true),
  agenda: () => openTasksView(),
  week: () => { AG.span = "week"; renderBoard(); },
  month: () => { AG.span = "month"; renderBoard(); },
  files: () => { goBack(); openFilesView(); },
  settings: () => { goBack(); settingsModal(); },
};

describe("contrast (A11Y-3)", () => {
  for (const theme of ["light", "dark"]) {
    test(`every text on the page against its background, ${theme} theme: 4.5 to 1, 3 to 1 for large text`, async () => {
      await openVault({ demo: false, time: NOW, notes: DATES });
      await ev((theme) => { UI.theme = theme; applyTheme(); }, theme);
      const { contrastAudit } = await import("./contrast.mjs");
      const low = [];
      for (const [view, go] of Object.entries(VIEWS)) {
        await page().evaluate(`(${go})()`);
        await settle();
        for (const f of await page().evaluate(contrastAudit, { min: 4.5, minLarge: 3 })) low.push(`${view}: ${f.ratio} < ${f.need} ${f.color} on ${f.back} ${f.where} "${f.text}"`);
      }
      await page().keyboard.press("Escape");
      await page().keyboard.press("Control+p");
      await settle();
      for (const f of await page().evaluate(contrastAudit, { min: 4.5, minLarge: 3 })) low.push(`palette: ${f.ratio} < ${f.need} ${f.color} on ${f.back} ${f.where} "${f.text}"`);
      assert.deepEqual([...new Set(low)], []);
      noErrors();
    });
  }
});
