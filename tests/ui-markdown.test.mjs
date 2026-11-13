// A note's contents: rendered Markdown, tables (shown and edited), planning lines under tasks, and pasted or dropped files.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

describe("rendering", () => {
  beforeEach(() => openVault({ demo: false, notes: { "cards/Target.md": "x", "cards/A.md": "" }, files: { "img/p.svg": H.SVG } }));
  const render = (md) => ev((md) => { const el = renderMarkdown(md, "cards/A.md"); document.body.append(el); return el.innerHTML; }, md);

  test("wiki links, tags, highlights, callouts, tasks and embeds", async () => {
    const html = await render("[[Target|go]] [[Missing]] #tag ==hi==\n\n> [!warning] Careful\n> body\n\n- [ ] task\n\n![[p.svg]]");
    assert.match(html, /<a (data-href="Target" class="internal-link"|class="internal-link" data-href="Target")>go<\/a>/);
    assert.match(html, /internal-link is-unresolved/);
    assert.match(html, /class="tag"[^>]*>#tag</);
    assert.match(html, /<mark>hi<\/mark>/);
    assert.match(html, /callout/);
    assert.match(html, /<li class="task-list-item is-state-todo[^"]*" data-task=" "><button type="button" class="task-box s-todo"/);
    assert.match(html, /class="task-box s-todo"[^>]*><svg class="task-svg"[^>]*><circle /, "a round box, as in the agenda");
    await H.page.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth === 40));
  });

  test("code blocks get a language header, line numbers and syntax colours", async () => {
    await render('```ts\n// note\nconst a = "<b>";\n```\n\n```\nplain <i>\n```\n\n```brainfuck\n+-\n```');
    const blocks = await ev(() => [...document.querySelectorAll(".code-block")].map((b) => ({
      head: b.querySelector(".code-head").textContent,
      lines: b.querySelectorAll(".code-gutter span").length,
      code: b.querySelector("pre > code").textContent,
      tokens: [...b.querySelectorAll("code span")].map((s) => [s.className, s.textContent]),
    })));
    assert.deepEqual(blocks, [
      { head: "TSTypeScript", lines: 2, code: '// note\nconst a = "<b>";', tokens: [["tok-com", "// note"], ["tok-kw", "const"], ["tok-str", '"<b>"']] },
      { head: "Plain text", lines: 1, code: "plain <i>", tokens: [] },
      { head: "brainfuck", lines: 1, code: "+-", tokens: [] },
    ]);
  });

  test("callouts have a title bar, and no body when there is no text", async () => {
    await render("> [!tip] Full\n> body\n\n> [!note] Bare");
    assert.deepEqual(await ev(() => [...document.querySelectorAll(".callout")].map((c) => [c.dataset.callout, c.querySelector(".callout-title").textContent, c.querySelector(".callout-content")?.textContent.trim() ?? null])), [
      ["tip", "Full", "body"],
      ["note", "Bare", null],
    ]);
  });

  test("callouts with + or - fold, and their title toggles them", async () => {
    await render("> [!info]- Folded\n> hidden\n\n> [!tip]+ Open\n> shown\n\n> [!note] Plain\n> x\n\n> [!todo]- Bare");
    const state = () => ev(() => [...document.querySelectorAll(".callout")].map((c) => [c.dataset.callout, c.classList.contains("is-collapsible"), c.classList.contains("is-collapsed"), !!c.querySelector(".callout-fold")]));
    assert.deepEqual(await state(), [["info", true, true, true], ["tip", true, false, true], ["note", false, false, false], ["todo", false, false, false]]);
    await ev(() => { const el = document.querySelector(".callout").closest("div:not(.callout)"); wireRendered(el, "cards/A.md"); document.querySelector(".callout-title").click(); });
    assert.equal((await state())[0][2], false);
    // the reader's fold is kept for the note while the page is open
    await render("> [!info]- Folded\n> hidden");
    assert.equal(await ev(() => [...document.querySelectorAll(".callout")].at(-1).classList.contains("is-collapsed")), false);
  });

  test("scripts and event handlers are removed", async () => {
    const html = await render('<script>window.x=1</script><img src=x onerror="window.y=1"><a href="javascript:alert(1)">l</a>');
    assert.doesNotMatch(html, /<script|onerror|javascript:/);
    assert.deepEqual(await ev(() => [window.x, window.y]), [undefined, undefined]);
  });

  test("every state renders as its icon, numbered in the order of the text", async () => {
    await render("- [ ] a\n- [/] b\n- [<] c\n- [x] d\n- [X] e\n- [-] f\n- [>] g\n- [?] h\n- plain\n\n> - [/] quoted\n\n```\n- [ ] code\n```\n\n- [/] [#A] pri");
    const r = await ev(() => [...document.body.lastChild.querySelectorAll(".task-box")].map((b) => `${b.dataset.task}${b.className.replace("task-box s-", ":")}:${b.nextSibling.textContent.trim()}`));
    assert.deepEqual(r, ["0:todo:a", "1:doing:b", "2:wait:c", "3:done:d", "4:done:e", "5:cancel:f", "6:fwd:g", "7:doing:quoted", "8:doing:"]);
    assert.equal(await ev(() => document.body.lastChild.querySelector(".task-box.s-doing ~ .pri.A")?.textContent), "[#A]", "the priority after the box is a pill");
    assert.equal(await ev(() => document.body.lastChild.querySelectorAll("li.is-checked").length), 4, "done, cancelled and forwarded tasks are closed");
  });

  test("clicking a rendered box ticks the task in the file, right-clicking picks a state", async () => {
    await ev(async () => { await writeRaw("cards/A.md", "- [ ] one\n- [/] two\n> - [ ] quoted\n"); openEditor("cards/A.md"); editor.mode = "read"; renderEditor(); });
    // a native click in the page (Playwright's actionability wait is flaky here)
    await H.page.waitForFunction(() => document.querySelectorAll(".sn-reading .task-box").length === 3);
    await ev(() => document.querySelectorAll(".sn-reading .task-box")[1].click());
    await H.page.waitForFunction(() => /^- \[ \] one\n- \[x\] two\n  CLOSED: \[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]\n> - \[ \] quoted\n$/.test(vault.notes.get("cards/A.md").raw));
    await ev(() => document.querySelectorAll(".sn-reading .task-box")[2].click());
    await H.page.waitForFunction(() => /\n> - \[x\] quoted\n$/.test(vault.notes.get("cards/A.md").raw));
    await ev(() => document.querySelectorAll(".sn-reading .task-box")[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await H.page.waitForSelector(".prompt .suggestion-item");
    assert.deepEqual(await H.page.$$eval(".prompt .suggestion-title", (x) => x.map((e) => e.textContent)), ["To do", "In progress", "Waiting / scheduling", "Done", "Cancelled", "Forwarded"]);
    await H.page.keyboard.type("forw");
    await H.page.keyboard.press("Enter");
    await H.page.waitForFunction(() => vault.notes.get("cards/A.md").raw.startsWith("- [>] one\n"));
  });
});

describe("tables and fonts", () => {
  beforeEach(() => openVault());

  test("a table fills the note width, keeps its column alignment and scrolls when too wide", async () => {
    const r = await ev(() => {
      const el = renderMarkdown("| Month | Km |\n| :--- | :-: |\n| Oct | 980 |\n", "cards/x.md");
      el.classList.add("markdown-rendered");
      el.style.width = "500px";
      document.body.append(el);
      const wrap = el.querySelector(".sn-table-wrap"), css = (s) => getComputedStyle(el.querySelector(s)).textAlign;
      const wide = renderMarkdown(`| ${"word ".repeat(0)}${Array(40).fill("Longheaderword").join(" | ")} |\n|${" --- |".repeat(40)}\n`, "cards/x.md");
      wide.classList.add("markdown-rendered");
      wide.style.width = "500px";
      document.body.append(wide);
      const w = wide.querySelector(".sn-table-wrap");
      return { table: el.querySelector("table").offsetWidth, wrap: wrap.clientWidth, first: css("tbody td:first-child"), second: css("tbody td:last-child"), scrolls: w.scrollWidth > w.clientWidth, wideBox: w.offsetWidth };
    });
    assert.equal(r.table, r.wrap);
    assert.equal(r.first, "start"); // :--- gives left, which reads as start
    assert.equal(r.second, "center");
    assert.ok(r.scrolls);
    assert.equal(r.wideBox, 500);
    noErrors();
  });

  test("Inter is the interface font and the writing font, and is embedded for Cyrillic too", async () => {
    const r = await ev(async () => {
      const family = (s) => getComputedStyle(document.body).getPropertyValue(s).trim();
      const ui = getComputedStyle(document.body).fontFamily;
      const reading = h("div", { cls: "sn-reading" });
      document.body.append(reading);
      const interText = getComputedStyle(reading).fontFamily;
      const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Inter").length;
      return { ui, interText, faces, family: family("--font-inter") };
    });
    assert.match(r.ui, /^"?Inter/);
    assert.match(r.interText, /^"?Inter/);
    assert.equal(r.faces, 2);
    noErrors();
  });
});

describe("table editing", () => {
  const body = "Intro\n\n| a | b |\n|---|:-:|\n| 1 | 22 |\n| 3 |  |";
  beforeEach(async () => { await openVault({ demo: false, notes: { "cards/T.md": body } }); await ev(() => openEditor("cards/T.md", { focus: true })); });
  const ta = ".sn-editor-text.is-live";
  const value = () => ev((sel) => $(sel).value, ta);
  const sel = () => ev(() => { const t = $(".sn-editor-text.is-live"); return t.value.slice(t.selectionStart, t.selectionEnd); });
  const text = () => ev(() => liveText());
  const cell = () => ev(() => { const el = $(".sn-cell-edit"); return el && el.contains(getSelection().anchorNode) ? getSelection().toString() || el.textContent : null; });
  const op = (text, o, row, col) => ev(([text, o, r, c]) => { const tb = findTables(text)[0], out = tableEdit(text, tb, o, r, c); return text.slice(0, out.from) + out.insert + text.slice(out.to); }, [text, o, row, col]);

  test("tables are found outside code and quotes, and cells keep escaped pipes", async () => {
    const r = await ev(() => findTables("```\n| a | b |\n|---|---|\n```\n> | q | w |\n> |---|---|\n\nx | y\n--|--\n1 | 2\nafter").map((t) => t.lines));
    assert.deepEqual(r, [["x | y", "--|--", "1 | 2"]]);
    assert.deepEqual(await ev(() => tableCells("| a\\|b | | c |")), ["a\\|b", "", "c"]);
    assert.deepEqual(await ev(() => parseTable(["| a | b | c |", "| :- | :-: | -: |", "| 1 |"])), { rows: [["a", "b", "c"], ["1", "", ""]], align: ["left", "center", "right"] });
  });

  test("formatTable lines up the columns, wide characters included", async () => {
    assert.equal(await ev(() => formatTable({ rows: [["Name", "N"], ["日本", "1"]], align: ["center", "right"] }).text), "| Name | N   |\n| :--: | --: |\n| 日本 | 1   |");
  });

  test("row and column operations", async () => {
    const t = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nnext";
    assert.equal(await op(t, "rowAbove", 2, 0), "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n| 3   | 4   |\n\nnext");
    assert.equal(await op(t, "rowUp", 2, 0), "| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1   | 2   |\n\nnext");
    assert.equal(await op(t, "colMoveRight", 0, 0), "| b   | a   |\n| --- | --- |\n| 2   | 1   |\n| 4   | 3   |\n\nnext");
    assert.equal(await op(t, "colDelete", 1, 1), "| a   |\n| --- |\n| 1   |\n| 3   |\n\nnext");
    assert.equal(await op(t, "alignCenter", 1, 1), "| a   | b   |\n| --- | :-: |\n| 1   | 2   |\n| 3   | 4   |\n\nnext");
    assert.equal(await op(t, "sortDesc", 1, 0), "| a   | b   |\n| --- | --- |\n| 3   | 4   |\n| 1   | 2   |\n\nnext");
    assert.equal(await op("| a |\n|---|\n| x |\n| 10 |\n| 9 |\n|  |", "sortAsc", 1, 0), "| a   |\n| --- |\n| 9   |\n| 10  |\n| x   |\n|     |", "numbers as numbers, empty cells last");
    assert.equal(await op("| a |\n|---|\n| 1 |\nnext", "colDelete", 0, 0), "next", "the last column takes the table with it");
  });

  test("a clicked cell is edited in the rendered table; Tab and Enter move between cells and add rows", async () => {
    await page().click("#editor .sn-live tbody tr:first-child td:nth-child(2)");
    assert.equal(await ev(() => !!$("#editor .lp-table .sn-cell-edit")), true, "the table stays rendered");
    assert.equal(await page().textContent(".sn-cell-edit"), "22");
    assert.equal(await ev(() => cellCaret($(".sn-cell-edit"))[0]), 1, "the caret goes where you click: the middle of the centred 22");
    await ev(() => cellSetCaret($(".sn-cell-edit"), 2));
    await page().keyboard.type("3");
    assert.equal(await text(), "Intro\n\n| a   | b   |\n| --- | :-: |\n| 1   | 223 |\n| 3   |     |", "the source lines up as you type");
    await page().keyboard.press("Tab");
    assert.equal(await cell(), "3", "the next cell, selected");
    await page().keyboard.press("Shift+Tab");
    assert.equal(await cell(), "223");
    await page().keyboard.press("Tab"); await page().keyboard.press("Tab");
    await page().keyboard.type("4");
    await page().keyboard.press("Tab");
    assert.equal(await ev(() => $$("#editor .sn-live tbody tr").length), 3, "Tab in the last cell adds a row");
    await page().keyboard.type("5");
    await page().keyboard.press("Enter");
    await page().keyboard.press("Enter");
    await page().keyboard.type("After");
    await page().keyboard.press("Control+s");
    await page().waitForFunction(() => vault.notes.get("cards/T.md").raw.includes("After"));
    assert.equal(await raw("cards/T.md"), "Intro\n\n| a   | b   |\n| --- | :-: |\n| 1   | 223 |\n| 3   | 4   |\n| 5   |     |\n\nAfter");
    noErrors();
  });

  test("a cell escapes pipes, saves when you leave it, and arrows leave the table", async () => {
    await page().click("#editor .sn-live tbody tr:last-child td:nth-child(2)");
    await page().keyboard.type("x|y");
    await page().keyboard.press("Escape");
    assert.equal(await ev(() => !!$(".sn-cell-edit")), false);
    assert.equal(await page().textContent("#editor .sn-live tbody tr:last-child td:nth-child(2)"), "x|y");
    await page().waitForFunction(() => vault.notes.get("cards/T.md").raw.includes("x\\|y"));
    await page().click("#editor .sn-live thead th:first-child");
    await page().keyboard.press("ArrowUp");
    assert.deepEqual(await ev(() => { const t = $(".sn-editor-text.is-live"); return [document.activeElement === t, t.selectionStart]; }), [true, 5], "up from the header goes to the end of the line above");
    noErrors();
  });

  test("macOS smart dashes don't break a table separator or a rule", async () => {
    const typed = (v) => ev((v) => {
      const t = $(".sn-editor-text.is-live");
      t.value = v; t.setSelectionRange(v.length, v.length);
      t.dispatchEvent(new InputEvent("input", { inputType: "insertReplacementText" }));
      return [t.value, t.selectionStart];
    }, v);
    assert.deepEqual(await typed("| Hello | One |\n| \u2014- | \u2014\u2014"), ["| Hello | One |\n| --- | ----", 28]);
    assert.deepEqual(await typed("\u2014-"), ["---", 3]);
    assert.deepEqual(await typed("Wait \u2014 here"), ["Wait \u2014 here", 11], "dashes in text stay");
  });

  test("Alt+arrows move rows and columns", async () => {
    await page().click("#editor .sn-live tbody tr:last-child td:first-child");
    await page().keyboard.press("Alt+ArrowUp");
    await page().keyboard.press("Alt+ArrowRight");
    assert.equal(await text(), "Intro\n\n| b   | a   |\n| :-: | --- |\n|     | 3   |\n| 22  | 1   |");
    assert.equal(await cell(), "3", "the cell moves with its row and column");
  });

  test("in a narrow note a wide table keeps its words whole and scrolls sideways", async () => {
    const r = await ev(async () => {
      await writeRaw("cards/T.md", "| Name | Type | Rating | Status | My rating | Comment |\n| --- | --- | --- | --- | --- | --- |\n| Resident Evil 2026 | Movie | 7.2 | Watched | 5 | Seen it in the cinema |\n");
      openEditor("cards/T.md", { focus: false });
      $("#editor .sn-editor-page").style.width = "380px";
      await new Promise((res) => setTimeout(res, 100));
      const wrap = $("#editor .sn-live .sn-table-wrap"), th = $$("#editor .sn-live th");
      const lines = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; };
      return { wide: wrap.classList.contains("is-wide"), scrolls: wrap.scrollWidth > wrap.clientWidth, lines: th.map(lines) };
    });
    assert.ok(r.wide && r.scrolls, "the frame scrolls");
    assert.deepEqual(r.lines.slice(1, 4), [1, 1, 1], "one-word headers are not cut into letters");
    noErrors();
  });

  test("a + button works on the first real click, from a cell being edited or from outside the table", async () => {
    await page().click("#editor .sn-live tbody tr:first-child td:first-child");
    assert.ok(await ev(() => !!$(".sn-cell-edit")), "a cell is being edited");
    await page().hover("#editor .sn-table-host");
    await page().click("#editor .sn-table-add-row");
    assert.equal(await ev(() => $$("#editor .sn-live tbody tr").length), 3);
    await page().click("#editor .sn-inline-title");
    await page().hover("#editor .sn-table-host");
    await page().click("#editor .sn-table-add-col");
    assert.equal(await ev(() => $("#editor .sn-live thead tr").cells.length), 3);
    noErrors();
  });

  test("the + buttons and the menu of a rendered table", async () => {
    await ev(() => $("#editor .sn-table-add-row").click());
    assert.equal(await text(), "Intro\n\n| a   | b   |\n| --- | :-: |\n| 1   | 22  |\n| 3   |     |\n|     |     |");
    assert.equal(await ev(() => $(".sn-cell-edit")?.closest("tr").rowIndex), 3, "the new row is being edited");
    await page().click("#editor .sn-live tbody tr:first-child td:first-child", { button: "right" });
    await page().click(".menu-item:has-text('Delete row')");
    assert.equal(await ev(() => $$("#editor .sn-live tbody tr").length), 2);
    await page().click("#editor .sn-live thead th:first-child", { button: "right" });
    assert.equal(await page().locator(".menu-item:has-text('Delete row')").count(), 0, "the header row stays");
    await page().click(".menu-item:has-text('Add column before')");
    assert.match(await text(), /^Intro\n\n\|     \| a   \| b   \|/);
    noErrors();
  });
});

describe("planning lines", () => {
  const NOTE = "- [ ] Book the tour\n  DEADLINE: <2026-11-07 Sat> SCHEDULED: <2026-11-05 Thu>\n\nIntro\n\n- [x] Set up\n  CLOSED: [2026-11-03 Tue 18:20]\n";
  beforeEach(async () => { await openVault({ demo: false, notes: { "cards/P.md": NOTE } }); await ev(() => openEditor("cards/P.md", { focus: false })); });
  const shown = (sel) => ev((s) => [...document.querySelectorAll(s)].map((x) => x.innerText.trim()), sel);

  test("while editing, SCHEDULED, DEADLINE and CLOSED are lowercase pills without their colon, dates pills without their brackets", async () => {
    assert.deepEqual(await shown("#editor .sn-live .org-plan"), ["deadline", "scheduled", "closed"]);
    assert.deepEqual(await shown("#editor .sn-live .org-ts"), ["2026-11-07 Sat", "2026-11-05 Thu", "2026-11-03 Tue 18:20"]);
    assert.equal(await raw("cards/P.md"), NOTE, "the note's text is unchanged");
    noErrors();
  });

  test("while reading, each date is one chip said as in the agenda, and the priority one letter", async () => {
    const note = "- [ ] [#A] Book the tour\n  DEADLINE: <2026-11-07 Sat> SCHEDULED: <2026-11-05 Thu>\n- [ ] Plan\n  DEADLINE: <2026-11-30 Mon>\n"
      + "- [ ] Weekly review\n  SCHEDULED: <2026-11-09 Mon 10:00 +1w>\n- [x] Set up\n  CLOSED: [2026-11-03 Tue 18:20]\n- [x] Old\n  DEADLINE: <2026-11-01 Sun>\n\nLunch <2026-11-06 Fri 13:00-14:00>\n";
    await openVault({ demo: false, time: "2026-11-06T09:00:00", openNotes: "read", notes: { "cards/R.md": note } });
    await ev(() => openEditor("cards/R.md", { focus: false }));
    const chips = await ev(() => [...document.querySelectorAll("#editor .sn-reading .org-date")].map((c) => [c.className.replace(/\b(ag-chip|org-date)\b/g, "").trim(), c.innerText.trim(), !!c.querySelector(".org-date-rep")]));
    assert.deepEqual(chips, [
      ["k-dead is-soon", "Tomorrow", false], ["k-sched", "Yesterday", false],
      ["k-dead", "30 Nov", false], // past its warning days: no colour yet
      ["k-sched", "In 3 d., 10:00", true],
      ["k-closed", "3 Nov", false],
      ["k-dead", "5 d. ago", false], // overdue, but the task is done: no red
      ["k-event", "Today, 13:00–14:00", false],
    ]);
    const r = await ev(() => ({
      words: document.querySelectorAll("#editor .sn-reading .org-plan, #editor .sn-reading .org-ts").length,
      tip: document.querySelector("#editor .sn-reading .org-date").title, pri: document.querySelector("#editor .sn-reading .pri.A")?.textContent,
    }));
    assert.equal(r.words, 0, "no Markdown words or timestamps left");
    assert.equal(r.tip, "DEADLINE: <2026-11-07 Sat>", "the Markdown in the tooltip");
    assert.equal(r.pri, "A");
    await ev(() => openEditor("cards/R.md", { focus: false, edit: true }));
    assert.equal(await ev(() => document.querySelectorAll("#editor .org-date").length), 0, "editing shows the Markdown again");
    assert.equal(await raw("cards/R.md"), note, "the note's text is unchanged");
    noErrors();
  });

  test("the caret in a date shows its brackets, the caret in a label its colon, as for the rest of the Markdown", async () => {
    const caret = (find, off) => ev(([f, o]) => { const ta = $(".sn-editor-text"); ta.focus(); ta.setSelectionRange(ta.value.indexOf(f) + o); }, [find, off]);
    await caret("2026-11-07", 3);
    await page().waitForTimeout(50);
    assert.deepEqual((await shown("#editor .sn-live .org-ts")).slice(0, 2), ["<2026-11-07 Sat>", "2026-11-05 Thu"]);
    await caret("DEADLINE", 3);
    await page().waitForTimeout(50);
    assert.ok((await ev(() => document.querySelector("#editor .sn-live .cm-line:nth-child(2)").innerText)).includes("DEADLINE:"));
    assert.deepEqual((await shown("#editor .sn-live .org-ts")).slice(0, 1), ["2026-11-07 Sat"]);
    noErrors();
  });

  test("orgTsLabel drops the brackets and joins a range with a dash", async () => {
    assert.deepEqual(await ev(() => ["<2026-11-05 Thu 10:00>", "[2026-11-03 Tue]", "<2026-11-05 Thu>--<2026-11-07 Sat>"].map(orgTsLabel)), ["2026-11-05 Thu 10:00", "2026-11-03 Tue", "2026-11-05 Thu – 2026-11-07 Sat"]);
  });
});

describe("pasted and dropped files", () => {
  const saveIn = (note = "cards/Notes/A.md", name = "photo.png", pasted = false) => ev(([note, name, pasted]) =>
    saveAttachment(new File(["png"], name, { type: "image/png" }), note, pasted), [note, name, pasted]);
  beforeEach(() => openVault({ demo: false, time: "2026-10-29T10:11:12", notes: { "cards/Notes/A.md": "text" } }));

  test("every file goes into attachments/, without overwriting", async () => {
    assert.equal(await saveIn(), "attachments/photo.png");
    assert.equal(await saveIn("daily notes/2026-10-29.md"), "attachments/photo 1.png", "no overwrite");
  });

  test("an attachments folder with other letter case is used as it is", async () => {
    await ev(() => vault.fs.write("Attachments/old.png", "x").then(() => vault.allPaths.add("Attachments/old.png")));
    assert.equal(await saveIn(), "Attachments/photo.png");
  });

  test("pasted images get a timestamp name", async () => {
    assert.equal(await saveIn("cards/Notes/A.md", "image.png", true), "attachments/Pasted image 20261029101112.png");
  });

  test("attachFiles saves and inserts embeds at the cursor", async () => {
    await ev(() => openEditor("cards/Notes/A.md", { focus: true }));
    const v = await ev(async () => {
      const ta = $(".sn-editor-text"); ta.setSelectionRange(4, 4);
      await attachFiles(ta, [new File(["png"], "a.png", { type: "image/png" }), new File(["zip"], "b.zip")]);
      return ta.value;
    });
    assert.equal(v, "text\n![[a.png]]\n![[b.zip]]".replace("![[b.zip]]", "[[b.zip]]"));
  });
});
