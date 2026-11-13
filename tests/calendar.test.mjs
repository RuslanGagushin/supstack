// The agenda's month (spec TASK-4) and the calendar file of dated tasks (TASK-7).
// The clock is frozen at Thursday 2026-10-29 10:00.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const NOW = "2026-10-29T10:00:00";
const NOTES = {
  "cards/Work.md": "- [ ] Write report\n  DEADLINE: <2026-10-27 Tue>\n- [/] Call Bob\n  SCHEDULED: <2026-10-25 Sun>\n- [x] Old thing\n  SCHEDULED: <2026-10-20 Tue>\n  CLOSED: [2026-10-20 Tue 09:00]\n## Meeting <2026-10-29 Thu 14:00-15:00>\n",
  "cards/Gym.md": "- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>\n",
};
before(() => openVault({ demo: false, time: NOW, notes: NOTES }));
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

describe("the month (TASK-4)", () => {
  /** The month on screen: its title, and for each day "D" or "D:count", in rows of seven; days of other months in (). */
  const month = () => ev(() => ({
    title: document.querySelector(".ag-title")?.textContent.trim(),
    rows: [...document.querySelectorAll(".ag-month-row:not(.ag-month-head)")].map((r) => [...r.querySelectorAll(".ag-mday")].map((b) => {
      const s = b.querySelector(".dn").textContent + (b.querySelector(".cnt") ? ":" + b.querySelector(".cnt").textContent : "");
      return b.classList.contains("is-out") ? `(${s})` : s;
    }).join(" ")),
    today: document.querySelector(".ag-mday.is-today .dn")?.textContent,
  }));

  test("M shows the month from Monday, with how many entries each day has", async () => {
    await ev(() => { openTasksView(); AG.view = "agenda"; AG.span = "week"; AG.anchor = null; AG.log = false; renderBoard(); });
    await page().focus(".ag-body");
    await page().keyboard.press("Shift+M");
    const m = await month();
    assert.equal(m.title, "Month October 2026");
    assert.deepEqual(m.rows, [
      "(28) (29) (30) 1 2 3 4",
      "5 6 7 8 9 10 11",
      "12 13 14 15 16 17 18",
      "19 20:1 21 22:1 23 24 25:1", // the 20th: the task done that day, as the day view lists it
      "26 27:1 28 29:2 30 31 (1)",
    ]);
    assert.equal(m.today, "29");
    noErrors();
  });

  test("the log adds what was closed; › goes to the next month; a click on a day opens it", async () => {
    await ev(() => { AG.log = true; AG.anchor = null; renderBoard(); });
    assert.match((await month()).rows[3], /^19 20:1 /, "the task closed on the 20th is counted once");
    await ev(() => { AG.log = false; renderBoard(); });
    await page().click('.agbar button[title^="Later"]');
    const nov = await month();
    assert.equal(nov.title, "Month November 2026");
    assert.deepEqual(nov.rows.map((r) => r.split(" ").filter((d) => d.includes(":") && !d.startsWith("("))).flat(), ["5:1", "12:1", "19:1", "26:1"], "the weekly run repeats");
    await page().click('.ag-mday[aria-label^="Thursday 12 November"]');
    assert.deepEqual(await ev(() => [AG.span, oFmt(AG.anchor, "YYYY-MM-DD")]), ["day", "2026-11-12"]);
    assert.match(await ev(() => document.querySelector(".ag-body").textContent), /Run/);
    noErrors();
  });
});
