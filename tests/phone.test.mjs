// A phone (spec §5.3): a touch screen 412px wide, where (pointer: coarse) and (hover: none) match.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const PHONE = { viewport: { width: 412, height: 915 }, touch: true, openNotes: "read" };
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

/** The buttons on top whose tap area is under 40px (a task's box: under 32px), with their size; a hit area drawn by ::after counts. */
const smallTargets = () => ev(() => {
  const out = [];
  for (const e of document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=checkbox], select")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    if (!top || !(e === top || e.contains(top) || top.contains(e))) continue; // under the note, a toast…
    if (!e.matches("button") && e.closest(".cm-content, .sn-reading, .ag-main, .sn-row-snippet")) continue; // a link in the text
    let [w, h] = [r.width, r.height];
    const a = getComputedStyle(e, "::after");
    if (a.content !== "none" && a.position === "absolute") { w -= (parseFloat(a.left) || 0) + (parseFloat(a.right) || 0); h -= (parseFloat(a.top) || 0) + (parseFloat(a.bottom) || 0); }
    if (Math.min(w, h) < (e.matches(".task-box") ? 32 : 40) - 0.5) out.push(`${(e.getAttribute("aria-label") || e.textContent.trim() || e.className).slice(0, 30)} ${Math.round(w)}×${Math.round(h)}`);
  }
  return out;
});

describe("tap targets (UI-9)", () => {
  test("in the list, a note being edited, the agenda and the task list, every button is at least 40px, a task's box 32px", async () => {
    await openVault(PHONE);
    assert.deepEqual(await smallTargets(), [], "the list");
    await ev(() => openEditor("cards/This week.md", { focus: false }));
    await settle();
    assert.deepEqual(await smallTargets(), [], "a note being read (fold chevrons beside task boxes)");
    await ev(() => closeEditor());
    await ev(() => openEditor("cards/This week.md", { edit: true, focus: false }));
    await settle();
    assert.deepEqual(await smallTargets(), [], "a note being edited");
    await ev(() => { closeEditor(); openTasksView(true, "agenda"); });
    await settle();
    assert.deepEqual(await smallTargets(), [], "the agenda");
    await ev(() => openTasksView(true, "todo"));
    await settle();
    assert.deepEqual(await smallTargets(), [], "the task list");
    noErrors();
  });
});

describe("the formatting bar (UI-10)", () => {
  test("it scrolls sideways, and its edge fades where more buttons are past it", async () => {
    await openVault(PHONE);
    await ev(() => openEditor("cards/This week.md", { edit: true, focus: false }));
    await settle();
    const state = () => ev(() => { const b = document.querySelector(".sn-ed-toolbar"); return { scrolls: b.scrollWidth > b.clientWidth, start: b.classList.contains("fade-start"), end: b.classList.contains("fade-end"), mask: getComputedStyle(b).maskImage !== "none" }; });
    assert.deepEqual(await state(), { scrolls: true, start: false, end: true, mask: true });
    await ev(() => { const b = document.querySelector(".sn-ed-toolbar"); b.scrollLeft = b.scrollWidth; });
    await settle();
    assert.deepEqual(await state(), { scrolls: true, start: true, end: false, mask: true });
    await page().setViewportSize({ width: 1280, height: 800 });
    await settle(); await settle();
    assert.deepEqual(await state(), { scrolls: false, start: false, end: false, mask: false }, "wide: no scrolling, no fade");
    noErrors();
  });
});

describe("keyboard hints (UI-11)", () => {
  test("a device without hover shows none in the palette", async () => {
    await openVault(PHONE);
    assert.equal(await ev(() => matchMedia("(hover: none)").matches), true);
    const shown = (sel) => ev((sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0), sel);
    await ev(() => { commandPalette(); });
    await settle();
    assert.equal(await shown(".prompt .suggestion-item"), true);
    assert.deepEqual([await shown(".prompt-instructions"), await shown(".prompt .suggestion-item .suggestion-keys")], [false, false], "the palette's foot and its rows' keys");
    await page().keyboard.press("Escape");
    await ev(() => settingsModal("keys"));
    await settle();
    assert.equal(await shown(".mod-settings .suggestion-keys"), true, "Settings › Keyboard shortcuts still lists them");
  });

  test("the agenda has no line of keys under it (? shows them)", async () => {
    await openVault({ viewport: { width: 1280, height: 800 } });
    await ev(() => openTasksView(true, "agenda"));
    await settle();
    assert.equal(await ev(() => !!document.querySelector(".ag-keys")), false);
  });
});

describe("the task list's state filters (UI-12)", () => {
  test("on 412px they stay on one line within the screen, scroll sideways when they must, and their names don't wrap; the filters are in the top bar", async () => {
    for (const lang of ["en", "ru"]) {
      await openVault({ ...PHONE, lang });
      await ev(() => openTasksView(true, "todo"));
      await settle();
      const r = await ev(() => {
        const seg = document.querySelector(".agbar > .sn-seg"), btns = [...seg.querySelectorAll("button")];
        const lineH = parseFloat(getComputedStyle(btns[0]).lineHeight) || 20;
        const s = seg.getBoundingClientRect();
        return {
          oneLine: btns.every((b) => Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 1),
          noWrap: btns.every((b) => { const sp = b.querySelector("span:last-child") || b; return sp.getBoundingClientRect().height < lineH * 1.5; }),
          onScreen: s.right <= innerWidth + 0.5 && (seg.scrollWidth <= seg.clientWidth || getComputedStyle(seg).overflowX === "auto"),
          filtersInTopBar: !!document.querySelector(".sn-topbar .ag-filters")?.getClientRects().length,
        };
      });
      assert.deepEqual(r, { oneLine: true, noWrap: true, onScreen: true, filtersInTopBar: true }, lang);
    }
    noErrors();
  });
});

describe("an agenda row on a phone (#25)", () => {
  test("without a time its date chip is under the title, lined up with its text; with a time, the time stays above", async () => {
    await openVault({ demo: false, time: "2026-10-29T10:00:00", viewport: { width: 412, height: 915 }, touch: true, notes: {
      "cards/Plan.md": "- [ ] Late one\n  SCHEDULED: <2026-10-27 Tue>\n- [ ] Timed today\n  SCHEDULED: <2026-10-29 Thu 11:00>\n",
    } });
    await ev(() => { AG.span = "week"; openTasksView(); });
    await H.page.waitForTimeout(300);
    const rows = await ev(() => Object.fromEntries([...document.querySelectorAll(".ag-row")].map((r) => {
      const main = r.querySelector(".ag-main"), box = main.querySelector(".task-box").getBoundingClientRect();
      // the chip that is shown: above the title (a time) or on the line under it (a date)
      const meta = [...r.querySelectorAll(".ag-meta > :not(:empty), .ag-lab-sub")].find((x) => x.getClientRects().length)?.getBoundingClientRect();
      return [[...main.childNodes].filter((n) => !n.classList?.contains("ag-sub")).map((n) => n.textContent).join("").trim(), { title: Math.round(main.getBoundingClientRect().top), meta: meta && Math.round(meta.top), metaLeft: meta && Math.round(meta.left), text: Math.round(box.right) }];
    })));
    const late = rows["Late one"], timed = rows["Timed today"];
    assert.ok(late && late.meta > late.title, `the date under the title: ${JSON.stringify(rows)}`);
    assert.ok(late.metaLeft > late.text, `lined up with the text, past the box: ${JSON.stringify(rows)}`);
    assert.ok(timed && timed.meta < timed.title, `the time above the title: ${JSON.stringify(rows)}`);
  });
});

describe("the agenda's bar on a phone (#29)", () => {
  test("Capture only in the bottom bar; the line over the title names the week, not the tab again", async () => {
    await openVault({ time: "2026-10-29T10:00:00", viewport: { width: 412, height: 915 }, touch: true, lang: "ru" });
    await ev(() => { AG.span = "week"; AG.view = "agenda"; openTasksView(); });
    await H.page.waitForTimeout(300);
    const m = await ev(() => ({
      own: [...document.querySelectorAll("button.ag-capture")].some((b) => b.getClientRects().length),
      tab: !!document.querySelector('.sn-tab[data-tab="capture"]')?.getClientRects().length,
      kind: document.querySelector(".ag-head .ag-kind").textContent,
    }));
    assert.deepEqual(m, { own: false, tab: true, kind: "Неделя 44" });
  });
});
