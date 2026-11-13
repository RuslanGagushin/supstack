// "Share to Supstack" on Android (spec TASK-6): what another app shares becomes a line in today's note or a new note in a notebook.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { openNativeApp, ev, settle } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const NOTES = { "cards/Reading.md": "Things to read.\n", "cards/Article.md": "---\nparents: [\"[[Reading]]\"]\n---\nOne.\n" };
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));
async function open(userAgent = ANDROID) {
  await openNativeApp({ notes: NOTES, expose: true, userAgent });
  await page().waitForFunction(() => vault.notes.size >= 2);
}
/** Share `shared` with the app as Android would, and give the dialog's fields. */
async function share(shared) {
  await ev((s) => { window.__shared = s; return checkShared(); }, shared);
  await settle();
  return ev(() => {
    const d = document.querySelector(".sn-share");
    return d && { title: d.querySelector(".sn-share-title").value, body: d.querySelector(".sn-share-body").value, to: [...d.querySelectorAll(".sn-share-to option")].map((o) => o.textContent) };
  });
}
const saveTo = async (label) => {
  await page().selectOption(".sn-share-to", { label });
  await page().click(".sn-share .is-primary");
  await settle();
};

describe("share to Supstack", () => {
  test("a shared link becomes a line in today's note, as a link", async () => {
    await open();
    const d = await share({ text: "https://example.com/article", subject: "A good article" });
    assert.deepEqual(d, { title: "A good article", body: "https://example.com/article", to: ["A line in today’s note", "A new note at the top level", "A new note in Reading"] });
    await saveTo("A line in today’s note");
    const raw = await ev(() => vault.notes.get(dailyNotePath())?.raw);
    assert.match(raw, /^- \[A good article\]\(https:\/\/example\.com\/article\) \[\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}\]\n$/);
    assert.equal(await ev(() => !!document.querySelector(".sn-share")), false);
    noErrors();
  });

  test("shared text becomes a new note in the notebook picked, titled by its first line", async () => {
    await open();
    const d = await share({ text: "Milk and bread\nand eggs", subject: "" });
    assert.deepEqual([d.title, d.body], ["Milk and bread", "Milk and bread\nand eggs"]);
    await saveTo("A new note in Reading");
    const p = "cards/Milk and bread.md";
    assert.equal(await ev((p) => vault.notes.has(p), p), true);
    assert.deepEqual(await ev((p) => graph.parentsOf(p), p), ["cards/Reading.md"]);
    assert.match(await ev((p) => vault.notes.get(p).body, p), /^Milk and bread\nand eggs\n$/);
    assert.equal(await ev(() => window.__shared), null, "taken once");
    noErrors();
  });

  test("the choice is remembered; nothing shared, or the desktop app, opens nothing", async () => {
    await open();
    await share({ text: "x", subject: "First" });
    await saveTo("A new note in Reading");
    const d = await share({ text: "y", subject: "Second" });
    assert.equal(await ev(() => document.querySelector(".sn-share-to").selectedOptions[0].textContent), "A new note in Reading");
    assert.ok(d);
    await page().click(".sn-share button:not(.is-primary):not(.modal-close)");
    assert.equal(await share(null), null);
    await open(null); // the desktop app
    assert.equal(await share({ text: "z", subject: "" }), null, "only Android takes shares");
    noErrors();
  });
});
