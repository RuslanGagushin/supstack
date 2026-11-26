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
    await ev(() => { openTasksView(); AG.view = "agenda"; AG.span = "week"; AG.anchor = null; renderBoard(); });
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

  test("what was closed stays on its day; › goes to the next month; a click on a day opens it", async () => {
    await ev(() => { AG.anchor = null; renderBoard(); });
    assert.match((await month()).rows[3], /^19 20:1 /, "the task closed on the 20th is counted once");
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

describe("the agenda's week (UI-13 to UI-17)", () => {
  // Thursday 29 October: "Call Bob" was scheduled on Sunday 25th and is overdue; "Parts" is due on 5 November, in its
  // warning days; "Trip" is scheduled on Tuesday 27th and due on Saturday 31st; the meeting is today at 14:00–15:00
  const WEEK = { ...NOTES,
    "cards/Trip.md": "- [ ] Trip\n  DEADLINE: <2026-10-31 Sat> SCHEDULED: <2026-10-27 Tue>\n",
    "cards/Parts.md": "- [<] Parts\n  DEADLINE: <2026-11-05 Thu -10d>\n" };
  before(async () => { await openVault({ demo: false, time: NOW, notes: WEEK }); await ev(() => { openTasksView(true, "agenda"); AG.span = "week"; AG.anchor = null; renderBoard(); }); });
  /** Each day as [its name, its rows' titles], the overdue section first as "Overdue". */
  const week = () => ev(() => [...document.querySelectorAll(".ag-body > .ag-card")].map((c) => [
    c.classList.contains("ag-overdue") ? "Overdue" : c.querySelector(".ag-day > span").textContent,
    [...c.querySelectorAll(".ag-row .ag-main")].map((m) => m.firstChild && m.querySelector(".ag-sub") ? [...m.childNodes].filter((n) => !n.classList?.contains("task-box") && !n.classList?.contains("ag-sub") && !n.classList?.contains("pri")).map((n) => n.textContent).join("").trim() : m.textContent.trim()),
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
    assert.deepEqual(today, ["now ", "15:00"], "the line for now leaves the time column to the times things start at");
    assert.equal(await ev(() => document.querySelector(".ag-card.is-today .ag-grid.now .ag-now-pill").textContent), "now 10:00", "its time is on its plate, the word for screen readers");
    assert.equal(await ev(() => document.querySelectorAll(".ag-card:not(.is-today) .ag-grid").length), 0);
    assert.deepEqual(await ev(() => orgWithGrid([{ time: null }])), [{ time: null }], "no times: no grid, no line for now");
  });

  test("now goes before what starts at its minute, takes an hour mark's place, and a run of empty hours is one mark", async () => {
    /** The grid of these entries at this minute, as "10:00 task", "now 10:00" and "11:00 -" for an hour mark. */
    const grid = (ents, now) => ev(([a, n]) => orgWithGrid(a, n).map((x) => (x.now ? "now " : "") + (x.time == null ? "" : String(x.time / 60).padStart(2, "0") + ":00") + (x.now ? "" : x.grid ? " -" : " " + x.t)), [ents, now]);
    assert.deepEqual(await grid([{ time: 600, t: "task" }, { time: 780, end: 840, t: "lunch" }, { time: null, t: "untimed" }], 600),
      ["now 10:00", "10:00 task", "11:00 -", "13:00 lunch", "14:00 -", " untimed"], "11:00 and 12:00 are one mark; an entry at now is not shown as past");
    assert.deepEqual(await grid([{ time: 600, t: "task" }, { time: 840, t: "call" }], 660),
      ["10:00 task", "now 11:00", "12:00 -", "14:00 call"], "now at 11:00 stands for the 11:00 mark; 12:00 and 13:00 are one");
    assert.deepEqual(await grid([{ time: 600, t: "task" }], 480), ["now 08:00", "10:00 task"], "now before the first entry");
  });

  test("a day without entries is one quiet line, not a card", async () => {
    const r = await ev(() => { const c = document.querySelector(".ag-card.is-empty"), s = getComputedStyle(c); return [s.borderTopColor, s.backgroundColor, c.querySelectorAll(".ag-row").length]; });
    assert.deepEqual(r, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", 0]);
  });

  test("the title says which days, the week's number in the line over it (restyle RS-58)", async () => {
    assert.deepEqual(await ev(() => [document.querySelector(".ag-title b").textContent, document.querySelector(".ag-head .ag-kind").textContent]), ["26 October – 1 November", "Week 44"]);
    const T = await ev(() => onow().dn);
    assert.deepEqual(await ev((T) => [dayRange(odn(2026, 11, 9), odn(2026, 11, 15), T), dayRange(odn(2026, 12, 28), odn(2027, 1, 3), T), dayRange(odn(2027, 3, 1), odn(2027, 3, 7), T)], T),
      ["9–15 November", "28 December 2026 – 3 January 2027", "1–7 March 2027"]);
    await ev(() => { AG.span = "day"; renderBoard(); });
    assert.deepEqual(await ev(() => document.querySelector(".ag-title b").textContent), "Thursday, 29 October");
    await ev(() => { AG.span = "week"; renderBoard(); });
  });

  test("the days' navigation is beside the title: it opens Go to…, then Day · Week · Month, then ‹ Today ›; the bar above has none", async () => {
    const head = () => ev(() => ({
      row: [...document.querySelectorAll(".ag-head .ag-title-row button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
      jump: document.querySelector(".ag-title button.ag-jump")?.title,
      agbar: !!document.querySelector(".agbar"),
      filters: document.querySelector(".sn-topbar .ag-filters")?.getAttribute("aria-label"),
    }));
    assert.deepEqual(await head(), { row: ["26 October – 1 November", "Day", "Week", "Month", "Earlier (b)", "Today", "Later (f)"], jump: "Go to… (j)", agbar: false, filters: "Filters" });
    await page().click(".ag-head button.ag-today");
    await page().click('.ag-head .ag-span button[title^="Day"]');
    assert.equal(await ev(() => document.querySelector(".ag-title b").textContent), "Thursday, 29 October");
    await page().click('.ag-head .ag-span button[title^="Week"]');
    // a tag in the filter: counted on the button, and its chip in the bar under it, where a click lets it go
    await ev(() => { AG.filter = { work: 1 }; renderBoard(); });
    assert.deepEqual(await ev(() => [document.querySelector(".sn-topbar .ag-filters").getAttribute("aria-label"), [...document.querySelectorAll(".agbar .ag-chips .sn-chip")].map((c) => c.textContent)]), ["Filters · 1", ["+work"]]);
    await page().click(".agbar .ag-chips .sn-chip");
    await page().click(".agbar .ag-chips .sn-chip");
    assert.deepEqual(await head().then((x) => [x.agbar, x.filters]), [false, "Filters"], "include, exclude, then off");
    noErrors();
  });

  test("labels are words, not abbreviations, in both languages", async () => {
    const labels = await ev(() => ["en", "ru"].flatMap((lang) => { setLang(lang); const out = [1, 2, 5].flatMap((n) => ["lIn", "lAgo", "lSchedLate", "relIn", "relAgo"].map((k) => tt(k, { n }))); setLang("en"); return out; }));
    const bad = labels.filter((l) => /\b(d|дн)\.|\d+\s*[x×]|Sched\./.test(l));
    assert.deepEqual(bad, []);
    assert.ok(labels.includes("Scheduled 2 days ago:") && labels.includes("План 5 дней назад:"), labels.join(" | "));
  });
});

describe("the task list and the capture form (UI-18, UI-19)", () => {
  before(() => openVault({ demo: false, time: NOW, notes: { ...NOTES, "cards/Gym.md": "- [ ] Run\n  SCHEDULED: <2026-10-22 Thu +1w>\n- [/] Stretch\n" } }));

  test("a task's note is a quiet caption after its title, not a column; a list without times has no time column", async () => {
    await ev(() => openTasksView(true, "todo"));
    const r = await ev(() => {
      const row = [...document.querySelectorAll(".ag-row")].find((x) => x.textContent.includes("Stretch"));
      const cat = row.querySelector(".ag-cat"), title = [...row.querySelector(".ag-main").childNodes].find((n) => n.textContent.includes("Stretch"));
      return { inMain: !!cat.closest(".ag-main"), text: cat.textContent, after: !!(title.compareDocumentPosition(cat) & Node.DOCUMENT_POSITION_FOLLOWING), areas: getComputedStyle(row).gridTemplateAreas, quiet: getComputedStyle(cat).color !== getComputedStyle(row.querySelector(".ag-main")).color };
    });
    assert.deepEqual(r, { inMain: true, text: "Gym", after: true, areas: '"main lab"', quiet: true });
  });

  test("the capture form is one line with its chips, Cancel and Save, and makes only tasks", async () => {
    for (const lang of ["en", "ru"]) {
      await openVault({ demo: false, lang, notes: NOTES });
      await ev(() => orgCapture());
      const r = await ev(() => ({
        input: document.activeElement?.classList.contains("cap-input"), fields: document.querySelectorAll(".ag-cap .cap-input[contenteditable]").length,
        acts: [...document.querySelectorAll(".ag-cap .cap-acts button")].map((b) => b.getAttribute("aria-label")),
        tpls: document.querySelectorAll(".cap-tpl-btn").length,
      }));
      assert.deepEqual(r, { input: true, fields: 1, acts: lang === "en" ? ["Cancel", "Save"] : ["Отмена", "Сохранить"], tpls: 0 }, lang);
      await page().keyboard.press("Escape");
    }
  });
});


describe("the time column in the week (#24)", () => {
  test("a group with no time starts its rows at the card's edge; a day with times keeps the column", async () => {
    await openVault({ demo: false, time: NOW, viewport: { width: 1440, height: 900 }, notes: {
      "cards/Plan.md": "- [ ] Late one\n  SCHEDULED: <2026-10-27 Tue>\n- [ ] Untimed today\n  SCHEDULED: <2026-10-29 Thu>\n- [ ] Timed today\n  SCHEDULED: <2026-10-29 Thu 11:00>\n- [ ] Untimed friday\n  SCHEDULED: <2026-10-30 Fri>\n",
    } });
    await ev(() => { AG.span = "week"; openTasksView(); });
    await page().waitForTimeout(300);
    const at = await ev(() => Object.fromEntries([...document.querySelectorAll(".ag-row")].map((r) => {
      const card = (r.closest(".ag-rows") || r.closest(".ag-card")).getBoundingClientRect();
      return [[...r.querySelector(".ag-main").childNodes].filter((n) => !n.classList?.contains("ag-sub")).map((n) => n.textContent).join("").trim(), Math.round(r.querySelector(".ag-main").getBoundingClientRect().left - card.left)];
    })));
    assert.ok(at["Late one"] <= 20 && at["Untimed friday"] <= 20, `no empty column without times: ${JSON.stringify(at)}`);
    assert.ok(at["Timed today"] > 80 && at["Untimed today"] === at["Timed today"], `a day with a time keeps it for every row: ${JSON.stringify(at)}`);
  });
});

describe("what the agenda's colours and labels mean (design review, phase 3)", () => {
  test("every day shows its date, today a plate after it; red is only for what is due or late", async () => {
    await openVault({ demo: false, time: NOW, viewport: { width: 1440, height: 900 }, notes: {
      "cards/Trip.md": "---\ntags: [travel]\n---\n- [/] [#A] Book the tour #plans\n  SCHEDULED: <2026-10-28 Wed> DEADLINE: <2026-10-30 Fri>\n",
      "cards/Home.md": "- [ ] Pack\n  SCHEDULED: <2026-10-29 Thu 11:00>\n",
    } });
    await ev(() => { AG.span = "week"; AG.view = "agenda"; AG.filter = {}; openTasksView(); });
    await page().waitForTimeout(300);
    const r = await ev(() => {
      const today = document.querySelector(".ag-card.is-today > .ag-day");
      const late = document.querySelector(".ag-overdue .ag-row");
      const red = getComputedStyle(document.querySelector(".ag-over-head")).color;
      const pri = getComputedStyle(late.querySelector(".pri.A"));
      const chip = (t) => [...late.querySelectorAll(".ag-sub .sn-chip")].find((c) => c.textContent === t);
      return {
        today: [today.querySelector(".num")?.textContent, today.querySelector(".today-pill")?.textContent],
        lab: [...late.querySelectorAll(".ag-meta .ag-lab .sn-chip")].map((c) => c.textContent),
        priRed: pri.color === red || pri.backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--due-bg"),
        nowRed: getComputedStyle(document.querySelector(".ag-now-pill")).backgroundColor === red,
        inherited: [chip("travel").className.includes("hue-") && chip("travel").className.includes("is-outline"), chip("travel").title],
        strip: document.querySelector('.ag-strip-day[aria-label^="Friday"]').getAttribute("aria-label"),
      };
    });
    assert.deepEqual(r, {
      today: ["29 October 2026", "Today"],
      lab: ["Scheduled 1 day ago", "Deadline tomorrow"],
      priRed: false, nowRed: false,
      inherited: [true, "Taken from its note"],
      strip: "Friday 30 October · 1 entry",
    });
    // the note's name opens the note
    await page().click(".ag-overdue .ag-row a.ag-cat");
    await page().waitForTimeout(300);
    assert.equal(await ev(() => editor.path), "cards/Trip.md");
    noErrors();
  });
});
