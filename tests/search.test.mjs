// Searching the list (spec §4.2): which notes match, in what order, and the line shown under each.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, settle } from "./harness.mjs";

/** Search for `query` in the list (scope "here" or "all") and give the titles shown, in order, with their preview lines. */
const search = (query, scope = "all", tags = []) => ev(([query, scope, tags]) => {
  board.filter = { query, tags, scope }; board.searchOpen = true; renderBoard();
  return [...document.querySelectorAll("#board .sn-rows .sn-card")].map((c) => ({
    title: c.querySelector(".sn-row-title")?.textContent, snippet: c.querySelector(".sn-row-snippet")?.textContent ?? "",
  }));
}, [query, scope, tags]);

describe("search snippets (SRCH-4)", () => {
  beforeEach(() => openVault());

  test("the line under a found note has no task boxes, priorities, planning lines or :tags:", async () => {
    const rows = await search("rome");
    const week = rows.find((r) => r.title === "This week");
    assert.ok(week, JSON.stringify(rows));
    assert.match(week.snippet, /Plan the Rome trip/);
    assert.doesNotMatch(week.snippet, /\[[ x/<>#-]|SCHEDULED|DEADLINE|CLOSED|:travel:/, week.snippet);
  });
});

describe("search order, tags and scope (SRCH-1, SRCH-2, SRCH-3)", () => {
  const notes = {
    "cards/Trips.md": "Where to go next.\n",
    "cards/Rome.md": "---\nparents: [\"[[Trips]]\"]\ntags: [travel]\n---\nThe city.\n",
    "cards/Diary.md": "---\ntags: [travel, draft]\n---\nWe saw Rome at night.\n",
    "cards/Guide.md": "---\nparents: [\"[[Trips]]\"]\ntags: [travel]\n---\n# Rome in a day\n\nStart early.\n",
    "cards/Work.md": "---\ntags: [work]\n---\nRome office.\n",
  };
  beforeEach(() => openVault({ demo: false, notes }));
  const titles = async (...a) => (await search(...a)).map((r) => r.title);

  test("a note with the words in its title comes first, then in a heading, then in the text", async () => {
    assert.deepEqual(await titles("rome"), ["Rome", "Guide", "Diary", "Work"]);
    assert.deepEqual(await titles("rome day"), ["Guide"]);
  });

  test("+tag requires a tag, -tag leaves notes with it out, and they mix with words and the Tags button", async () => {
    assert.deepEqual(await titles("rome +travel"), ["Rome", "Guide", "Diary"]);
    assert.deepEqual(await titles("rome +travel -draft"), ["Rome", "Guide"]);
    assert.deepEqual(await titles("+#travel"), ["Diary", "Guide", "Rome"], "with only tags the list keeps its own order");
    assert.deepEqual(await titles("rome", "all", ["work", "draft"]), ["Diary", "Work"], "the Tags button lets through any of its tags");
  });

  test("Here searches the notebook you are in, Everywhere the whole vault", async () => {
    await ev(() => setTarget("cards/Trips.md"));
    assert.deepEqual(await titles("rome", "here"), ["Rome", "Guide"]);
    assert.deepEqual((await titles("rome", "all")).length, 4);
  });

  test("the index follows notes as they are saved, renamed and deleted", async () => {
    assert.deepEqual(await titles("gelato"), []);
    await ev(() => writeRaw("cards/Work.md", "---\ntags: [work]\n---\nGelato near the office.\n"));
    assert.deepEqual(await titles("gelato"), ["Work"]);
    await ev(() => renameCard("cards/Work.md", "Office"));
    await settle(); // the list's notebooks follow on the next frame
    assert.deepEqual(await titles("gelato"), ["Office"]);
    await ev(() => removeNote("cards/Office.md"));
    await settle();
    assert.deepEqual(await titles("gelato"), []);
  });
});
