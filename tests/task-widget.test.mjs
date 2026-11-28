import assert from "node:assert/strict";
import { test } from "node:test";
import { odn } from "../web/src/js/core/org.js";
import { taskEntry } from "../web/src/js/core/tasks.js";
import { widgetDays } from "../web/src/js/core/task-widget.js";
import { ev, openNativeApp } from "./harness.mjs";

const task = (id, fields) => ({ id, title: id, state: " ", ...fields });
const tasks = [
  task("late-and-due", { sched: "<2026-11-27 Fri>", dead: "<2026-11-28 Sat>" }),
  task("due", { dead: "<2026-11-28 Sat>" }),
  task("timed", { sched: "<2026-11-28 Sat 09:00>" }),
  task("repeat", { sched: "<2026-11-28 Sat +1d>" }),
  task("closed", { state: "x", dead: "<2026-11-28 Sat>" }),
  task("event", { state: null, when: "<2026-11-28 Sat 12:00>" }),
  task("soon", { dead: "<2026-12-03 Thu -7d>" }),
  task("undated", {}),
];
const ids = (rows) => rows.map(({ id }) => id);

test("widget projects seven calendar days and deduplicates open tasks", () => {
  const days = widgetDays(tasks.map((record) => taskEntry(record)), odn(2026, 11, 28));
  assert.equal(Object.keys(days).length, 7);
  assert.deepEqual(ids(days["2026-11-28"].overdue), ["late-and-due"]);
  assert.deepEqual(ids(days["2026-11-28"].today), ["timed", "due", "repeat"]);
  assert.deepEqual(ids(days["2026-11-29"].today), ["repeat"]);
  assert.deepEqual(ids(days["2026-12-04"].overdue), ["late-and-due", "due", "soon", "timed"]);
});

test("Android publishes a committed snapshot and opens the exact task or quick capture", async () => {
  const page = await openNativeApp({
    viewport: { width: 400, height: 800 },
    clock: "2026-11-28T12:00:00",
    expose: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
    notes: { ".supstack/tasks.jsonl": tasks.map((record) => JSON.stringify(record)).join("\n") },
  });
  await page.waitForFunction(() => window.__taskWidget?.days);
  assert.equal(await ev(() => window.__taskWidget.root), "/vault");
  async function act(action) {
    await ev((target) => {
      window.__widgetAction = target;
      window.dispatchEvent(new Event("supstack-task-widget"));
    }, action);
  }
  await act({ action: "task", root: "/vault", id: "timed" });
  await page.waitForSelector('.ag-row.is-selected[data-id="timed"]');
  await page.click('.ag-row[data-id="timed"] [data-act="tick"]');
  await page.waitForFunction(() => !window.__taskWidget.days["2026-11-28"].today.some(({ id }) => id === "timed"));
  await ev(async (record) => {
    window.__vaultFiles[".supstack/tasks.jsonl"].text += JSON.stringify(record) + "\n";
    await pollChanges({ force: true });
  }, task("synced", { dead: "<2026-11-28 Sat>" }));
  await page.waitForFunction(() => window.__taskWidget.days["2026-11-28"].today.some(({ id }) => id === "synced"));
  await act({ action: "task", root: "/old", id: "due" });
  await page.waitForFunction(() => !document.querySelector(".ag-row.is-selected"));
  await act({ action: "add" });
  await page.waitForSelector(".ag-cap.is-quick");
});
