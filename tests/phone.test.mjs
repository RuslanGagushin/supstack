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
  test("a device without hover shows none: under the agenda, in the palette, in the capture form", async () => {
    await openVault(PHONE);
    assert.equal(await ev(() => matchMedia("(hover: none)").matches), true);
    const shown = (sel) => ev((sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0), sel);
    await ev(() => openTasksView(true, "agenda"));
    await settle();
    assert.equal(await shown(".ag-keys"), false, "the line under the agenda");
    await ev(() => { commandPalette(); });
    await settle();
    assert.equal(await shown(".prompt .suggestion-item"), true);
    assert.deepEqual([await shown(".prompt-instructions"), await shown(".prompt .suggestion-item .suggestion-keys")], [false, false], "the palette's foot and its rows' keys");
    await page().keyboard.press("Escape");
    await ev(() => orgCapture());
    await settle();
    assert.equal(await shown(".cap-keys"), false, "the capture form's keys");
    await ev(() => settingsModal("keys"));
    await settle();
    assert.equal(await shown(".mod-settings .suggestion-keys"), true, "Settings › Keyboard shortcuts still lists them");
  });

  test("with a mouse they are there", async () => {
    await openVault({ viewport: { width: 1280, height: 800 } });
    await ev(() => openTasksView(true, "agenda"));
    await settle();
    assert.equal(await ev(() => getComputedStyle(document.querySelector(".ag-keys")).display !== "none"), true);
  });
});

describe("the task list's state filters (UI-12)", () => {
  test("on 412px they stay on one line beside the filters button, scroll sideways, and their names don't wrap", async () => {
    for (const lang of ["en", "ru"]) {
      await openVault({ ...PHONE, lang });
      await ev(() => openTasksView(true, "todo"));
      await settle();
      const r = await ev(() => {
        const seg = document.querySelector(".agbar > .sn-seg"), btns = [...seg.querySelectorAll("button")];
        const lineH = parseFloat(getComputedStyle(btns[0]).lineHeight) || 20;
        const f = document.querySelector(".agbar .ag-filters").getBoundingClientRect(), s = seg.getBoundingClientRect();
        return {
          oneLine: btns.every((b) => Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 1),
          noWrap: btns.every((b) => { const sp = b.querySelector("span:last-child") || b; return sp.getBoundingClientRect().height < lineH * 1.5; }),
          scrolls: seg.scrollWidth > seg.clientWidth, besideFilters: Math.abs(f.top + f.height / 2 - (s.top + s.height / 2)) < 4 && f.left >= s.right,
        };
      });
      assert.deepEqual(r, { oneLine: true, noWrap: true, scrolls: true, besideFilters: true }, lang);
    }
    noErrors();
  });
});
