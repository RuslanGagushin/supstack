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
    assert.equal(m.title, "October 2026");
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
    await page().click('.ag-head button[aria-label^="Later"]');
    const nov = await month();
    assert.equal(nov.title, "November 2026");
    assert.deepEqual(nov.rows.map((r) => r.split(" ").filter((d) => d.includes(":") && !d.startsWith("("))).flat(), ["5:1", "12:1", "19:1", "26:1"], "the weekly run repeats");
    await page().click('.ag-mday[aria-label^="Thursday 12 November"]');
    assert.deepEqual(await ev(() => [AG.span, oFmt(AG.anchor, "YYYY-MM-DD")]), ["day", "2026-11-12"]);
    assert.match(await ev(() => document.querySelector(".ag-body").textContent), /Run/);
    noErrors();
  });
});

describe("the calendar file (TASK-7)", () => {
  const TRIP = "---\ntags: [travel]\n---\n- [ ] [#A] Book flights; seats, meals \\ bags :work:\n  SCHEDULED: <2026-11-02 Mon 09:30> DEADLINE: <2026-11-06 Fri>\n- Stay in [[Rome|Rome]] <2026-11-10 Tue>--<2026-11-13 Fri>\n- [ ] Не забыть паспорт и очень длинное название задачи, чтобы строку пришлось переносить\n  SCHEDULED: <2026-11-09 Mon>\n";
  before(() => openVault({ demo: false, time: NOW, notes: { ...NOTES, "cards/Trip.md": TRIP } }));
  const ics = () => ev(() => tasksToIcs(orgAll(), { now: new Date(Date.UTC(2026, 9, 29, 7)), labels: { deadline: "Deadline" } }));
  /** The file's events as { property: value }, unfolded. */
  const events = (text) => text.replace(/\r\n /g, "").split("BEGIN:VEVENT").slice(1).map((ev) => Object.fromEntries(ev.split("\r\n").filter((l) => l && !l.startsWith("END:")).map((l) => { const i = l.search(/[:;]/); return [l.slice(0, i), l.slice(i + (l[i] === ":" ? 1 : 0))]; })));

  test("open tasks' SCHEDULED and DEADLINE dates and events become events; done tasks stay out", async () => {
    const { text, events: n } = await ics();
    const evs = events(text);
    assert.equal(n, evs.length);
    const by = (s) => evs.filter((e) => e.SUMMARY === s);
    assert.deepEqual(by("Run").map((e) => [e.DTSTART, e.DTEND, e.RRULE]), [[";VALUE=DATE:20261022", ";VALUE=DATE:20261023", "FREQ=WEEKLY;INTERVAL=1"]], "a whole day, repeating");
    assert.deepEqual(by("Book flights\\; seats\\, meals \\\\ bags").map((e) => [e.DTSTART, e.DTEND, e.PRIORITY, e.CATEGORIES, e.DESCRIPTION]),
      [["20261102T093000", undefined, "1", "travel,work", "cards/Trip.md"]], "a time, the text escaped, its priority and tags");
    assert.equal(by("Deadline: Book flights\\; seats\\, meals \\\\ bags")[0].DTSTART, ";VALUE=DATE:20261106");
    assert.deepEqual(by("Meeting").map((e) => [e.DTSTART, e.DTEND]), [["20261029T140000", "20261029T150000"]], "a time range");
    assert.deepEqual(by("Stay in Rome").map((e) => [e.DTSTART, e.DTEND]), [[";VALUE=DATE:20261110", ";VALUE=DATE:20261114"]], "a date range ends the day after");
    assert.equal(by("Old thing").length, 0, "a done task is not exported");
    assert.equal(new Set(evs.map((e) => e.UID)).size, evs.length, "every event has its own UID");
    assert.ok(evs.every((e) => e.DTSTAMP === "20261029T070000Z"));
  });

  test("the file is valid iCalendar: CRLF lines folded at 75 bytes, one calendar around the events", async () => {
    const { text } = await ics();
    assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:/);
    assert.match(text, /END:VCALENDAR\r\n$/);
    assert.doesNotMatch(text.replace(/\r\n/g, ""), /[\r\n]/, "no bare line breaks");
    const enc = new TextEncoder();
    assert.ok(text.split("\r\n").every((l) => enc.encode(l).length <= 75), "no line over 75 bytes");
    assert.match(text, /SUMMARY:Не забыть паспорт.*\r\n /, "a long Cyrillic title is folded");
    assert.equal(text.split("BEGIN:VEVENT").length, text.split("END:VEVENT").length);
  });

  test("the agenda's button saves it as a file", async () => {
    await ev(() => { openTasksView(); AG.view = "agenda"; AG.span = "week"; renderBoard(); });
    const [dl] = await Promise.all([page().waitForEvent("download"), page().click(".agbar .ag-ics")]);
    assert.equal(dl.suggestedFilename(), "Supstack tasks.ics");
    noErrors();
  });
});

describe("the agenda's week (UI-13 to UI-17)", () => {
  // Thursday 29 October: "Call Bob" was scheduled on Sunday 25th and is overdue; "Parts" is due on 5 November, in its
  // warning days; "Trip" is scheduled on Tuesday 27th and due on Saturday 31st; the meeting is today at 14:00–15:00
  const WEEK = { ...NOTES,
    "cards/Trip.md": "- [ ] Trip\n  DEADLINE: <2026-10-31 Sat> SCHEDULED: <2026-10-27 Tue>\n",
    "cards/Parts.md": "- [<] Parts\n  DEADLINE: <2026-11-05 Thu -10d>\n" };
  before(async () => { await openVault({ demo: false, time: NOW, notes: WEEK }); await ev(() => { openTasksView(true, "agenda"); AG.span = "week"; AG.anchor = null; AG.log = false; renderBoard(); }); });
  /** Each day as [its name, its rows' titles], the overdue section first as "Overdue". */
  const week = () => ev(() => [...document.querySelectorAll(".ag-body > .ag-card")].map((c) => [
    c.classList.contains("ag-overdue") ? "Overdue" : c.querySelector(".ag-day > span").textContent,
    [...c.querySelectorAll(".ag-row .ag-main")].map((m) => m.firstChild && m.querySelector(".ag-cat") ? [...m.childNodes].filter((n) => !n.classList?.contains("task-box") && !n.classList?.contains("ag-cat") && !n.classList?.contains("pri")).map((n) => n.textContent).join("").trim() : m.textContent.trim()),
  ]));

  test("a task is listed on its plan's day and its deadline's day; an overdue one under Overdue only, not again in the past", async () => {
    const w = Object.fromEntries((await week()).map(([d, rows]) => [d, rows]));
    assert.deepEqual([...w.Overdue].sort(), ["Call Bob", "Trip", "Write report"], "what is overdue, under today");
    assert.ok(!w.Sunday.includes("Call Bob") && !w.Tuesday.includes("Write report") && !w.Tuesday.includes("Trip"), "not again on its past day");
    assert.ok(w.Saturday.includes("Trip"), "and on its deadline's day");
    const all = Object.values(w).flat();
    assert.equal(all.filter((x) => x === "Trip").length, 2);
    assert.equal(all.filter((x) => x === "Parts").length, 1, "a deadline's early warning, today, when nothing else lists it");
  });

  test("a week without today keeps an open task on its own past day", async () => {
    const r = await ev(() => { const T = onow().dn, bob = odn(2026, 10, 25); return [true, false].map((carried) => orgDayEntries(bob, orgAll(), T, { carried }).map((x) => x.e.title)); });
    assert.deepEqual(r, [[], ["Call Bob"]]);
  });

  test("the hour grid runs only between today's first and last times, an hour apart; a day without times has none", async () => {
    const today = await ev(() => [...document.querySelectorAll(".ag-card.is-today .ag-grid")].map((g) => (g.classList.contains("now") ? "now " : "") + g.querySelector(".ag-time").textContent));
    assert.deepEqual(today, ["now 10:00", "15:00"]);
    assert.equal(await ev(() => document.querySelectorAll(".ag-card:not(.is-today) .ag-grid").length), 0);
    assert.deepEqual(await ev(() => orgWithGrid([{ time: null }])), [{ time: null }], "no times: no grid, no line for now");
  });

  test("a day without entries is one quiet line, not a card", async () => {
    const r = await ev(() => { const c = document.querySelector(".ag-card.is-empty"), s = getComputedStyle(c); return [s.borderTopColor, s.backgroundColor, c.querySelectorAll(".ag-row").length]; });
    assert.deepEqual(r, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", 0]);
  });

  test("the title says which days, the week's number in the line over it (restyle RS-58)", async () => {
    assert.deepEqual(await ev(() => [document.querySelector(".ag-title b").textContent, document.querySelector(".ag-head .ag-kind").textContent]), ["26 October – 1 November", "Agenda · Week 44"]);
    const T = await ev(() => onow().dn);
    assert.deepEqual(await ev((T) => [dayRange(odn(2026, 11, 9), odn(2026, 11, 15), T), dayRange(odn(2026, 12, 28), odn(2027, 1, 3), T), dayRange(odn(2027, 3, 1), odn(2027, 3, 7), T)], T),
      ["9–15 November", "28 December 2026 – 3 January 2027", "1–7 March 2027"]);
    await ev(() => { AG.span = "day"; renderBoard(); });
    assert.deepEqual(await ev(() => document.querySelector(".ag-title b").textContent), "Thursday, 29 October");
    await ev(() => { AG.span = "week"; renderBoard(); });
  });

  test("labels are words, not abbreviations, in both languages", async () => {
    const labels = await ev(() => ["en", "ru"].flatMap((lang) => { setLang(lang); const out = [1, 2, 5].flatMap((n) => ["lIn", "lAgo", "lSchedLate", "relIn", "relAgo"].map((k) => tt(k, { n }))); setLang("en"); return out; }));
    const bad = labels.filter((l) => /\b(d|дн)\.|\d+\s*[x×]|Sched\./.test(l));
    assert.deepEqual(bad, []);
    assert.ok(labels.includes("Scheduled 2 days ago:") && labels.includes("План 5 дней назад:"), labels.join(" | "));
  });
});

describe("the task list and the capture form (UI-18, UI-19)", () => {
  before(() => openVault({ demo: false, time: NOW, notes: { ...NOTES, "cards/Gym.md": "- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>\n- [ ] Stretch\n" } }));

  test("a task's note is a quiet caption after its title, not a column; a list without times has no time column", async () => {
    await ev(() => openTasksView(true, "todo"));
    const r = await ev(() => {
      const row = [...document.querySelectorAll(".ag-row")].find((x) => x.textContent.includes("Stretch"));
      const cat = row.querySelector(".ag-cat"), title = [...row.querySelector(".ag-main").childNodes].find((n) => n.textContent.includes("Stretch"));
      return { inMain: !!cat.closest(".ag-main"), text: cat.textContent, after: !!(title.compareDocumentPosition(cat) & Node.DOCUMENT_POSITION_FOLLOWING), areas: getComputedStyle(row).gridTemplateAreas, quiet: getComputedStyle(cat).color !== getComputedStyle(row.querySelector(".ag-main")).color };
    });
    assert.deepEqual(r, { inMain: true, text: "Gym", after: true, areas: '"main lab"', quiet: true });
  });

  test("the capture form says Save and Cancel, and shows each template's letter as a key", async () => {
    for (const [lang, ok, cancel] of [["en", "Save", "Cancel"], ["ru", "Сохранить", "Отмена"]]) {
      await openVault({ demo: false, lang, notes: NOTES });
      await ev(() => orgCapture());
      const r = await ev(() => ({
        buttons: [...document.querySelectorAll(".ag-cap .modal-buttons button")].map((b) => b.textContent),
        tpls: [...document.querySelectorAll(".cap-tpl-btn")].map((b) => [b.querySelector("b").textContent, b.querySelector("kbd").textContent]),
      }));
      assert.deepEqual(r.buttons, [cancel, ok], lang);
      assert.deepEqual(r.tpls.map(([, k]) => k), ["t", "n", "m", "j"]);
      assert.ok(r.tpls.every(([name]) => !/\[/.test(name)), JSON.stringify(r.tpls));
      await page().keyboard.press("Escape");
    }
  });
});

