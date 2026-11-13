// Reminders (spec TASK-1, TASK-2, TASK-3): tasks whose SCHEDULED or DEADLINE date has a time notify at that time.
// The app runs as in Tauri, with the notification plugin answered in memory and the page's clock moved by hand
// from Thursday 2026-10-29 10:00.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openNativeApp, ev } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const NOW = "2026-10-29T10:00:00";
const DAY = "- [ ] Call Ann\n  SCHEDULED: <2026-10-29 Thu 10:05>\n- [ ] Pay rent\n  DEADLINE: <2026-10-29 Thu 11:00>\n- [x] Done already\n  SCHEDULED: <2026-10-29 Thu 10:30>\n- [ ] No time\n  SCHEDULED: <2026-10-29 Thu>\n- [ ] Stretch\n  SCHEDULED: <2026-10-28 Wed 09:00 +1d>\n";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
/** Open the app on `notes`, and let the clock run `ms` so the vault is read and the reminders planned. */
async function open(notes, { permission = "granted", userAgent = null, storage = {} } = {}) {
  await openNativeApp({ notes, expose: true, clock: NOW, userAgent, storage, answers: { "plugin:notification|is_permission_granted": null, "plugin:notification|request_permission": permission } });
  await page().clock.runFor(1000);
  await ev(() => new Promise((r) => { const t = () => (vault.notes.size ? r() : setTimeout(t, 10)); t(); }));
  await page().clock.runFor(3000);
}
/** The notification plugin's calls since `from`: [command, the notification's title and its time if scheduled, or the ids]. */
const calls = () => ev(() => window.__invokes.filter(([c]) => c.startsWith("plugin:notification|")).map(([c, a]) => {
  const cmd = c.split("|")[1];
  if (cmd === "notify") return [cmd, a.options.title, a.options.schedule?.at.date ?? null];
  if (cmd === "cancel") return [cmd, a.notifications.length];
  return [cmd];
}));
const clearCalls = () => ev(() => { window.__invokes.length = 0; });

describe("which tasks remind, and when", () => {
  test("open tasks with a time, at that time; repeats each time; done tasks and dates without a time never", async () => {
    await open({ "cards/Day.md": DAY });
    const r = await ev(() => upcomingReminders(orgAll(), Date.now(), { days: 2 }).map((x) => [x.title, new Date(x.at).toTimeString().slice(0, 5), x.body]));
    assert.deepEqual(r, [
      ["Call Ann", "10:05", "Scheduled · 10:05"],
      ["Pay rent", "11:00", "Deadline · 11:00"],
      ["Stretch", "09:00", "Scheduled · 09:00"], // tomorrow: today's 9:00 is past
      ["Stretch", "09:00", "Scheduled · 09:00"], // and the day after
    ]);
    const ids = await ev(() => upcomingReminders(orgAll(), Date.now(), { days: 2 }).map((x) => x.id));
    assert.equal(new Set(ids).size, ids.length, "each has its own id");
    assert.ok(ids.every((id) => Number.isInteger(id) && id > 0 && id < 2 ** 31), "ids fit an Android int");
  });
});

describe("on desktop", () => {
  test("permission is asked once there is a task with a time; the reminder comes at its minute", async () => {
    await open({ "cards/Day.md": DAY });
    assert.deepEqual(await calls(), [["is_permission_granted"], ["request_permission"]]);
    await clearCalls();
    await page().clock.runFor(4 * 60 * 1000);
    assert.deepEqual(await calls(), [], "nothing before 10:05");
    await page().clock.runFor(60 * 1000);
    assert.deepEqual(await calls(), [["notify", "Call Ann", null]]);
    noErrors();
  });

  test("a task closed, deleted or moved before its time no longer reminds (TASK-2)", async () => {
    await open({ "cards/Day.md": DAY });
    await ev(() => writeRaw("cards/Day.md", vault.notes.get("cards/Day.md").raw.replace("- [ ] Pay rent", "- [x] Pay rent").replace("10:05", "12:00")));
    await page().clock.runFor(3000); // planned again a little after the save
    await clearCalls();
    await page().clock.runFor(90 * 60 * 1000);
    const notified = async () => (await calls()).filter(([c]) => c === "notify");
    assert.deepEqual(await notified(), [], "not at 10:05 (moved), not at 11:00 (done)");
    await page().clock.runFor(30 * 60 * 1000);
    assert.deepEqual(await notified(), [["notify", "Call Ann", null]], "at its new time");
    noErrors();
  });

  test("a vault without a time in its tasks never asks; a refusal is kept and nothing breaks (TASK-3)", async () => {
    await open({ "cards/Plain.md": "- [ ] Someday\n  SCHEDULED: <2026-10-30 Fri>\n" });
    assert.deepEqual(await calls(), [], "no task with a time: no question");
    await open({ "cards/Day.md": DAY }, { permission: "denied" });
    assert.deepEqual(await calls(), [["is_permission_granted"], ["request_permission"]]);
    await clearCalls();
    await ev(() => writeRaw("cards/Day.md", vault.notes.get("cards/Day.md").raw + "- [ ] More\n  SCHEDULED: <2026-10-29 Thu 10:10>\n"));
    await page().clock.runFor(15 * 60 * 1000);
    assert.deepEqual(await calls(), [["is_permission_granted"]], "not asked again, nothing shown");
    noErrors();
  });
});

describe("on Android", () => {
  test("reminders are scheduled with the system ahead of time; one no longer due is cancelled", async () => {
    await open({ "cards/Day.md": DAY }, { userAgent: ANDROID });
    const scheduled = (await calls()).filter(([c]) => c === "notify");
    assert.deepEqual(scheduled.slice(0, 3), [
      ["notify", "Call Ann", new Date("2026-10-29T10:05:00").toISOString()],
      ["notify", "Pay rent", new Date("2026-10-29T11:00:00").toISOString()],
      ["notify", "Stretch", new Date("2026-10-30T09:00:00").toISOString()],
    ]);
    assert.equal(scheduled.length, 2 + 14, "and the daily one for the next two weeks");
    await clearCalls();
    await ev(() => writeRaw("cards/Day.md", vault.notes.get("cards/Day.md").raw.replace("- [ ] Pay rent", "- [-] Pay rent")));
    await page().clock.runFor(3000);
    assert.deepEqual(await calls(), [["is_permission_granted"], ["cancel", 1]], "the cancelled task's reminder goes; the others stay as they were");
    noErrors();
  });
});
