// Searching the list (spec §4.2): which notes match, in what order, and the line shown under each.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";

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
