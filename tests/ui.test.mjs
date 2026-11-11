// The app in use: board, navigation, search, tags, editor, autocomplete, rendering, pasted files, palettes, settings, themes and phones.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
// cards in reading order (the masonry DOM is in column order); checks that each one is on the page too
const titles = () => ev(() => {
  const shown = boardModel().shown.map((c) => c.path);
  const onPage = new Set([...document.querySelectorAll("#board .sn-masonry .sn-card")].map((c) => c.dataset.path));
  return shown.filter((p) => onPage.has(p)).map((p) => p.replace(/^cards\/|\.md$/g, ""));
});
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

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

describe("board", () => {
  beforeEach(() => openVault());

  test("the demo board shows the top-level cards in manual order", async () => {
    const t = await titles();
    assert.deepEqual(t.slice(0, 4), ["This week", "History", "Architecture", "Knowledge"]);
    assert.ok(!t.includes("Roman Empire"), "children are not on the top level at depth 1");
    noErrors();
  });

  test("open a card as the board, breadcrumbs, back and up", async () => {
    await ev(() => setTarget("cards/Roman Empire.md"));
    assert.deepEqual(await titles(), ["Colosseum", "Aqueducts"], "child_order");
    assert.match(await page().textContent(".sn-crumbs"), /All cards.*History.*Roman Empire/);
    await page().keyboard.press("Alt+ArrowUp");
    assert.equal(await ev(() => board.target), "cards/History.md");
    await page().keyboard.press("Alt+ArrowLeft");
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    noErrors();
  });

  test("a note is edited as a page in the board's place; the board's own note is never beside its hero", async () => {
    await ev(() => setTarget("cards/Roman Empire.md"));
    await page().click(".sn-hero-tools button[aria-label]:first-child");
    const st = () => ev(() => ({ path: editor.path, wide: editor.wide, board: getComputedStyle($(".sn-main")).display }));
    const besideBtn = () => ev(() => $$("#editor .sn-editor-head button").some((b) => b.title === t("collapseEditor")));
    assert.deepEqual(await st(), { path: "cards/Roman Empire.md", wide: true, board: "none" }, "the cards below the hero are hidden");
    assert.equal(await besideBtn(), false, "no way to put it beside its hero");
    await page().keyboard.press("Escape");
    await page().click('.sn-card[data-path="cards/Colosseum.md"] .sn-card-edit:not(.sn-card-add)');
    assert.deepEqual(await st(), { path: "cards/Colosseum.md", wide: true, board: "none" }, "a card from the list opens as a page too");
    assert.equal(await besideBtn(), true, "a card can still be put beside the board");
    await ev(() => $$("#editor .sn-editor-head button").find((b) => b.title === t("collapseEditor")).click());
    await ev(() => openEditor("cards/Aqueducts.md"));
    assert.equal(await ev(() => editor.wide), false, "beside the board, the next note stays beside it");
    await ev(() => setTarget("cards/Aqueducts.md"));
    assert.equal(await ev(() => editor.path), null, "going to the open note's board closes it beside");
    await ev(() => openEditor("cards/Colosseum.md"));
    assert.equal(await ev(() => editor.wide), true, "after closing, the next note opens as a page again");
    noErrors();
  });

  test("no status line under the board or the note; code in a code block has no grey chip", async () => {
    await ev(() => setTarget("cards/Roman Empire.md"));
    await ev(() => openEditor("cards/Colosseum.md", { mode: "read" }));
    assert.equal(await ev(() => document.querySelectorAll(".modeline").length), 0);
    const bg = await ev(() => {
      const box = renderMarkdown("Inline `x`\n\n```js\nconst a = 1;\n```\n", "cards/x.md");
      box.classList.add("markdown-rendered");
      document.body.append(box);
      const r = [getComputedStyle(box.querySelector(".code-body code")).backgroundColor, getComputedStyle(box.querySelector("p code")).backgroundColor];
      box.remove();
      return r;
    });
    assert.equal(bg[0], "rgba(0, 0, 0, 0)", "the code block's text sits on the block");
    assert.notEqual(bg[1], "rgba(0, 0, 0, 0)", "inline code keeps its chip");
    noErrors();
  });

  test("depth ∞ over a parent cycle finishes", async () => {
    await ev(() => { board.depth = 0; setTarget("cards/Cycle A.md"); });
    assert.deepEqual(await titles(), ["Cycle B"]);
    await ev(() => { setTarget(null); });
    assert.ok((await titles()).length > 10);
    noErrors();
  });

  test("search filters the board, Escape closes it", async () => {
    await ev(() => { board.depth = 0; renderBoard(); });
    await page().keyboard.press("Control+f");
    await page().keyboard.type("aqueduct");
    await page().waitForFunction(() => board.filter.query === "aqueduct" && document.querySelectorAll("#board .sn-masonry .sn-card").length === 4);
    assert.deepEqual(await titles(), ["This week", "Roman Empire", "Aqueducts", "Pont du Gard"], "titles and text both match");
    await page().keyboard.press("Escape");
    await page().keyboard.press("Escape");
    assert.equal(await ev(() => board.searchOpen), false);
  });

  test("a tag view collects cards from the whole vault", async () => {
    await ev(() => openTagView("definition"));
    assert.deepEqual((await titles()).sort(), ["Back-of-napkin math", "Choice paralysis", "Manual mode"]);
    await ev(() => goBack());
    assert.equal(await ev(() => board.tagView), null);
  });

  test("the composer types into a new card from anywhere on the board", async () => {
    await page().focus("#board");
    await page().keyboard.type("Fresh idea");
    await page().waitForFunction(() => $(".sn-composer textarea")?.value === "Fresh idea");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => vault.notes.has("cards/Fresh idea.md"));
    noErrors();
  });

  test("select mode and Delete with several cards selected", async () => {
    await ev(() => { board.selection = new Set(["cards/Knowledge.md", "cards/Draft thoughts.md"]); renderBoard(); });
    assert.match(await page().textContent(".sn-selbar"), /2 selected/);
    await page().focus('#board .sn-card[data-path="cards/Knowledge.md"]');
    await page().keyboard.press("Delete");
    await page().click(".modal .mod-warning");
    await page().waitForFunction(() => !vault.notes.has("cards/Knowledge.md") && !vault.notes.has("cards/Draft thoughts.md"));
    await page().keyboard.press("Control+z");
    await page().waitForFunction(() => vault.notes.has("cards/Knowledge.md") && vault.notes.has("cards/Draft thoughts.md"));
  });
});

describe("editor", () => {
  beforeEach(async () => { await openVault({ demo: false, notes: { "cards/Note.md": "---\ncolor: red\n---\nHello\n", "cards/Colosseum.md": "", "cards/Cola.md": "", "cards/pic.md": "" } }); await ev(() => openEditor("cards/Note.md", { focus: true })); });
  const ta = ".sn-editor-text";
  const value = () => ev((sel) => $(sel).value, ta);
  const setValue = (v, s = v.length, e = s) => ev(([v, s, e]) => { const t = $(".sn-editor-text"); t.value = v; t.setSelectionRange(s, e); t.focus(); }, [v, s, e]);

  test("typing saves the body and keeps the frontmatter", async () => {
    await page().focus(ta);
    await page().keyboard.press("End");
    await ev(() => { const t = $(".sn-editor-text"); t.setSelectionRange(t.value.length, t.value.length); });
    await page().keyboard.type("World");
    await page().keyboard.press("Control+s");
    await page().waitForFunction(() => vault.notes.get("cards/Note.md").raw.includes("World"));
    assert.equal(await raw("cards/Note.md"), "---\ncolor: red\n---\nHello\nWorld");
    noErrors();
  });

  test("Enter as Android sends it breaks the line: CodeMirror dispatches its own keydown on the editor", async () => {
    await setValue("Hello");
    // what CodeMirror does when an Android keyboard reports Enter only as input: a synthetic keydown on its content element
    const handled = await ev(() => { const e = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, cancelable: true }); $(".sn-editor-text").dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(handled, true, "CodeMirror's keymap handles it");
    await page().keyboard.type("World");
    assert.equal(await value(), "Hello\nWorld");
    noErrors();
  });

  test("the editor is CodeMirror: undo and redo cover typing and formatting", async () => {
    assert.equal(await ev(() => !!$(".sn-editor-text").cmView), true);
    await setValue("plain", 0, 5);
    await page().keyboard.press("Control+b");
    await page().keyboard.press("End");
    await page().keyboard.type(" more");
    assert.equal(await value(), "**plain** more");
    await page().keyboard.press("ControlOrMeta+z");
    assert.equal(await value(), "**plain**", "undo takes back the typing");
    await page().keyboard.press("ControlOrMeta+z");
    assert.equal(await value(), "plain", "then the bold");
    await page().keyboard.press("ControlOrMeta+Shift+z");
    assert.equal(await value(), "**plain**");
    noErrors();
  });

  test("lines stop wrapping only while the caret is on a table row", async () => {
    const wraps = () => ev(() => $(".sn-editor-text").classList.contains("cm-lineWrapping"));
    await setValue("| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext", 2);
    await page().keyboard.press("ArrowRight");
    assert.equal(await wraps(), false, "caret on the table");
    await page().keyboard.press("ControlOrMeta+End");
    assert.equal(await wraps(), true, "caret below it: wrapping is back");
    await page().keyboard.press("ControlOrMeta+Home");
    await page().keyboard.press("ControlOrMeta+End");
    assert.equal(await wraps(), true, "and again the second time");
    noErrors();
  });

  test("Ctrl+B and Ctrl+I wrap the selection", async () => {
    await setValue("make bold", 5, 9);
    await page().keyboard.press("Control+b");
    assert.equal(await value(), "make **bold**");
    await setValue("x", 0, 1);
    await page().keyboard.press("Control+i");
    assert.equal(await value(), "*x*");
  });

  test("Enter continues lists and checkboxes, ends them on an empty item", async () => {
    await setValue("- one");
    await page().keyboard.press("Enter");
    assert.equal(await value(), "- one\n- ");
    await page().keyboard.press("Enter");
    assert.equal(await value(), "- one\n\n", "a blank line, so the next text doesn't join the last item");
    await setValue("1. a");
    await page().keyboard.press("Enter");
    assert.equal(await value(), "1. a\n2. ");
    await setValue("- [x] done");
    await page().keyboard.press("Enter");
    assert.equal(await value(), "- [x] done\n- [ ] ");
  });

  test("Tab indents and Shift+Tab outdents", async () => {
    await setValue("a\nb", 0, 3);
    await page().keyboard.press("Tab");
    assert.equal(await value(), "\ta\n\tb");
    await page().keyboard.press("Shift+Tab");
    assert.equal(await value(), "a\nb");
  });

  test("toolbar helpers: headings cycle, prefixes toggle", async () => {
    const run = (v, fn, s = 0, e = v.length) => ev(([v, fn, s, e]) => { const t = $(".sn-editor-text"); t.value = v; t.setSelectionRange(s, e); ({ h: () => edHeading(t), q: () => edPrefix(t, "> "), n: () => edPrefix(t, "1. "), l: () => edPrefix(t, "- "), w: () => edWrap(t, "`") })[fn](); return t.value; }, [v, fn, s, e]);
    assert.equal(await run("T", "h"), "# T");
    assert.equal(await run("### T", "h"), "T");
    assert.equal(await run("a\nb", "n"), "1. a\n2. b");
    assert.equal(await run("1. a\n2. b", "n"), "a\nb");
    assert.equal(await run("- a", "q"), "> - a");
    assert.equal(await run("1. a", "l"), "- a");
    assert.equal(await run("`x`", "w"), "x");
  });

  test("[[ suggests notes and Enter inserts the link", async () => {
    await setValue("see ");
    await page().keyboard.type("[[Colo");
    await page().waitForSelector(".ac-pop .ac-item");
    await page().keyboard.press("Enter");
    assert.equal(await value(), "see [[Colosseum]]");
    noErrors();
  });

  test("the title renames the note", async () => {
    await page().fill(".sn-inline-title", "Renamed note");
    await page().press(".sn-inline-title", "Enter");
    await page().waitForFunction(() => vault.notes.has("cards/Renamed note.md"));
    assert.equal(await ev(() => editor.path), "cards/Renamed note.md");
  });

  test("Escape closes the editor and Ctrl+E toggles reading view", async () => {
    await page().focus(ta);
    await page().keyboard.press("Control+e");
    assert.equal(await ev(() => editor.mode), "read");
    await page().keyboard.press("Control+e");
    assert.equal(await ev(() => editor.mode), "edit");
    await ev(() => { UI.editorWide = false; editor.wide = true; });
    await page().focus(ta);
    await page().keyboard.press("Escape");
    assert.equal(await ev(() => editor.path), null);
  });
});

describe("live preview", () => {
  const body = "# Title\n\nPara **bold** text\n\n- [ ] one\n- [ ] two\n\nLast";
  beforeEach(async () => { await openVault({ demo: false, notes: { "cards/L.md": "---\ncolor: red\n---\n" + body, "cards/Other.md": "" } }); await ev(() => openEditor("cards/L.md", { focus: true })); });
  const ta = ".sn-editor-text.is-live";
  const value = () => ev((sel) => $(sel).value, ta);
  const lines = () => ev(() => $$("#editor .cm-line").map((l) => l.textContent));
  const caretAt = (i) => ev((i) => { const t = $(".sn-editor-text.is-live"); t.focus(); t.setSelectionRange(i); }, i);

  test("the note is one editor; away from the caret its Markdown renders in place", async () => {
    assert.equal(await value(), body);
    const ls = await lines();
    assert.equal(ls[0], "Title");
    assert.equal(ls[2], "Para bold text");
    assert.equal(await ev(() => $("#editor .cm-sn-h1")?.textContent), "Title");
    assert.equal(await ev(() => $("#editor .cm-sn-strong").textContent), "bold");
    assert.equal(await ev(() => $$("#editor .task-box").length), 2);
    noErrors();
  });

  test("the Markdown shows where the caret is", async () => {
    await page().click("#editor .cm-sn-strong");
    assert.equal((await lines())[2], "Para **bold** text");
    const caret = await ev(() => $(".sn-editor-text.is-live").selectionStart), at = body.indexOf("**bold**");
    assert.ok(caret >= at && caret <= at + 8, `caret ${caret} inside **bold**`);
    assert.equal((await lines())[0], "Title", "other lines stay rendered");
    await caretAt(2);
    assert.equal((await lines())[0], "# Title");
    assert.equal((await lines())[2], "Para bold text");
  });

  test("Enter continues a list, and ends it on an empty item", async () => {
    await caretAt(body.indexOf("two") + 3);
    await page().keyboard.press("Enter");
    await page().keyboard.type("three");
    await page().keyboard.press("Enter");
    await page().keyboard.press("Enter");
    await page().keyboard.type("After");
    await page().keyboard.press("Control+s");
    await page().waitForFunction(() => vault.notes.get("cards/L.md").raw.includes("After"));
    assert.match(await raw("cards/L.md"), /- \[ \] two\n- \[ \] three\n\nAfter\n\nLast$/);
  });

  test("a rendered box ticks its own task", async () => {
    await page().click("#editor .task-box >> nth=1");
    assert.match(await value(), /- \[ \] one\n- \[x\] two/);
    await page().keyboard.press("Control+s");
    await page().waitForFunction(() => vault.notes.get("cards/L.md").raw.includes("- [x] two"));
    noErrors();
  });

  test("every state shows its icon; Ctrl+Enter steps the state, a plain line becomes a task; right-click picks any state", async () => {
    await ev(() => { const t = $(".sn-editor-text.is-live"); t.cmView.dispatch({ changes: { from: 0, to: t.value.length, insert: "- [/] b\n- [<] c\n- [-] f\n- [>] g\n- [x] d\n  CLOSED: [2026-11-03 Tue 18:20]\nplain" } }); t.blur(); });
    assert.deepEqual(await ev(() => $$("#editor .task-box").map((b) => b.className.replace("task-box s-", ""))), ["doing", "wait", "cancel", "fwd", "done"]);
    assert.ok(await ev(() => !!$("#editor .cm-sn-task.s-cancel")), "a cancelled task's text is struck through");
    await caretAt((await value()).length);
    await page().keyboard.press("Control+Enter");
    assert.match(await value(), /\n- \[ \] plain$/);
    await page().keyboard.press("Control+Enter");
    assert.match(await value(), /\n- \[\/\] plain$/);
    await ev(() => $(".sn-editor-text.is-live").blur());
    await ev(() => $$("#editor .task-box")[4].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await page().waitForSelector(".prompt .suggestion-item");
    await page().keyboard.type("waiting");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => $(".sn-editor-text.is-live").value.includes("- [<] d\n- [/] plain"), null, { timeout: 5000 });
    assert.doesNotMatch(await value(), /CLOSED/, "reopening drops CLOSED");
    noErrors();
  });

  test("selecting text shows the floating format bar, and its buttons format the selection", async () => {
    const at = body.indexOf("Para");
    await ev((at) => { const t = $(".sn-editor-text.is-live"); t.focus(); t.setSelectionRange(at, at + 4); }, at);
    await H.tick();
    assert.ok(await page().isVisible(".sn-fmtbar"));
    const box = await page().locator(".sn-fmtbar").boundingBox(), line = await page().locator("#editor .cm-line >> nth=2").boundingBox();
    assert.ok(box.y + box.height <= line.y + 4, "above the selected line");
    await page().click('.sn-fmtbar [data-act="italic"]');
    assert.match(await value(), /\n\*Para\* \*\*bold\*\* text\n/);
    assert.deepEqual(await ev(() => { const t = $(".sn-editor-text.is-live"); return [t.selectionStart, t.selectionEnd]; }), [at + 1, at + 5], "the text stays selected");
    await caretAt(at + 3);
    await H.tick();
    assert.equal(await page().locator(".sn-fmtbar").count(), 0, "gone when nothing is selected");
  });

  test("a click on a rendered link opens it, as in reading mode (Ctrl/Cmd+click: in the editor)", async () => {
    await caretAt(0);
    await page().keyboard.type("See [[Other]] ");
    await caretAt(await ev(() => $(".sn-editor-text.is-live").value.length));
    await page().click("#editor .cm-sn-wikilink", { modifiers: ["ControlOrMeta"] });
    assert.equal(await ev(() => editor.path), "cards/Other.md");
  });

  test("a callout renders as a block and opens into its Markdown when clicked", async () => {
    await ev(() => { const t = $(".sn-editor-text.is-live"); t.value = "Top\n\n> [!tip] Hint\n> inside\n\nEnd"; t.setSelectionRange(0); });
    await page().click("#editor .cm-line >> nth=0");
    assert.equal(await ev(() => $("#editor .lp-block .callout .callout-title-inner")?.textContent), "Hint");
    await page().click("#editor .lp-block .callout-content");
    assert.equal(await ev(() => !!$("#editor .lp-block .callout")), false, "the callout shows its Markdown");
    assert.ok((await lines()).includes("> [!tip] Hint"));
    noErrors();
  });
});

describe("planning lines", () => {
  const NOTE = "- [ ] Book the tour\n  DEADLINE: <2026-11-07 Sat> SCHEDULED: <2026-11-05 Thu>\n\nIntro\n\n- [x] Set up\n  CLOSED: [2026-11-03 Tue 18:20]\n";
  beforeEach(async () => { await openVault({ demo: false, notes: { "cards/P.md": NOTE } }); await ev(() => openEditor("cards/P.md", { focus: false })); });
  const shown = (sel) => ev((s) => [...document.querySelectorAll(s)].map((x) => x.innerText.trim()), sel);

  test("SCHEDULED, DEADLINE and CLOSED are lowercase pills without their colon, dates pills without their brackets", async () => {
    assert.deepEqual(await shown("#editor .sn-live .org-plan"), ["deadline", "scheduled", "closed"]);
    assert.deepEqual(await shown("#editor .sn-live .org-ts"), ["2026-11-07 Sat", "2026-11-05 Thu", "2026-11-03 Tue 18:20"]);
    await ev(() => { editor.mode = "read"; renderEditor(); });
    assert.deepEqual(await shown("#editor .sn-reading .org-plan"), ["deadline", "scheduled", "closed"]);
    assert.deepEqual(await shown("#editor .sn-reading .org-ts"), ["2026-11-07 Sat", "2026-11-05 Thu", "2026-11-03 Tue 18:20"]);
    assert.equal(await ev(() => document.querySelector("#editor .sn-reading .org-ts").title), "<2026-11-07 Sat>", "the full timestamp in the tooltip");
    assert.equal(await raw("cards/P.md"), NOTE, "the note's text is unchanged");
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

describe("palettes, settings, language and themes", () => {
  beforeEach(() => openVault());

  test("Ctrl+O opens a card by fuzzy name", async () => {
    await page().keyboard.press("Control+o");
    await page().keyboard.type("pont");
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.target), "cards/Pont du Gard.md");
  });

  test("the command palette runs a command", async () => {
    await page().keyboard.press("Control+p");
    await page().keyboard.type("files");
    await page().keyboard.press("Enter");
    assert.equal(await ev(() => board.view), "files");
  });

  test("settings and keyboard shortcuts open without errors", async () => {
    await ev(() => settingsModal("board"));
    assert.match(await page().textContent(".modal"), /Default depth/);
    await page().keyboard.press("Escape");
    await ev(() => hotkeysModal());
    assert.match(await page().textContent(".modal"), /All files in the vault/);
    noErrors();
  });

  test("settings list their sections on the side, arrow keys move between them, the last one is remembered and the search finds rows", async () => {
    await ev(() => settingsModal("appearance"));
    const tabs = () => page().$$eval(".sn-set-tab", (b) => b.map((x) => [x.textContent, x.getAttribute("aria-selected")]));
    assert.deepEqual((await tabs()).map((x) => x[0]), ["Appearance", "Keyboard shortcuts", "About"], "no Git section outside the app; the board's options are in Appearance");
    assert.match(await page().textContent(".sn-set-body"), /Theme/);
    assert.match(await page().textContent(".sn-set-body"), /Default depth/, "the interface and the board's defaults in one section");
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /Parents field/, "one group at a time");
    const height = await page().$eval(".modal", (m) => m.offsetHeight);
    await page().click(".sn-set-tab:has-text('Keyboard shortcuts')");
    assert.equal(await page().$eval(".modal", (m) => m.offsetHeight), height, "the dialog keeps its size between tabs");
    await page().click(".sn-set-tab:has-text('Appearance')");
    await page().focus(".sn-set-tab.is-active");
    await page().keyboard.press("ArrowDown");
    assert.equal((await tabs()).find((x) => x[1] === "true")[0], "Keyboard shortcuts");
    await page().keyboard.press("ArrowDown");
    assert.equal((await tabs()).find((x) => x[1] === "true")[0], "About");
    await page().keyboard.press("Escape");
    await ev(() => settingsModal());
    assert.equal(await page().textContent(".sn-set-tab.is-active"), "About");
    await ev(() => settingsModal("about")); // already open: switches tabs instead of stacking a second dialog
    assert.equal(await page().$$eval(".modal", (m) => m.length), 1);
    await page().fill(".sn-set-search", "preview");
    assert.match(await page().textContent(".sn-set-body"), /Preview length/, "the search looks through every section");
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /Theme/);
    noErrors();
  });

  test("About shows the version; the web page has nothing to update", async () => {
    await ev(() => settingsModal("about"));
    const body = await page().textContent(".sn-set-body");
    assert.match(body, /Supstack/);
    assert.match(body, new RegExp("Version " + (await ev(() => APP_VERSION)).replace(/\./g, "\\.") + " · web page"));
    assert.match(body, /Release notes/);
    assert.doesNotMatch(body, /Check now/, "no update check in the browser");
    assert.deepEqual(await ev(() => [isNewer("0.8.0", "0.7.1"), isNewer("v0.7.10", "0.7.9"), isNewer("1.0.0", "1.0.0"), isNewer("0.7.1", "0.8.0"), isNewer("1.0", "0.9.9")]), [true, true, false, false, true]);
    noErrors();
  });

  test("theme toggle switches to dark", async () => {
    const before = await ev(() => document.body.classList.contains("theme-dark"));
    await ev((before) => { UI.theme = before ? "light" : "dark"; applyTheme(); }, before);
    assert.equal(await ev(() => document.body.classList.contains("theme-dark")), !before);
  });

  test("the Russian interface", async () => {
    await openVault({ lang: "ru" });
    assert.match(await page().textContent(".sn-hero-title"), /Все карточки/);
    assert.match(await page().textContent("#files-btn"), /Файлы/);
    noErrors();
  });
});

describe("no top bar", () => {
  test("the agenda, Files and settings are in the sidebar; a view's own bar opens the sidebar when it is closed", async () => {
    await openVault({ viewport: { width: 1280, height: 800 } });
    assert.equal(await ev(() => !!$(".wb-top")), false, "no top bar");
    assert.deepEqual(await ev(() => ["#tasks-btn", "#files-btn"].map((s) => !!$(s)?.closest(".sn-side .sb-nav"))), [true, true]);
    assert.equal(await ev(() => !!$(".sn-side .sb-foot [aria-label='" + t("settings") + "']")), true, "settings at the sidebar's foot");
    const toggleShown = () => ev(() => { const b = $(".sn-board .sn-side-toggle"); return !!b && getComputedStyle(b).display !== "none"; });
    assert.equal(await toggleShown(), false, "no opener while the sidebar is open");
    await page().click(".sb-collapse");
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
    assert.equal(await toggleShown(), true);
    await page().click(".sn-board .sn-side-toggle");
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), false);
    noErrors();
  });
});

describe("sidebar", () => {
  const shown = (sel) => ev((sel) => { const el = $(sel); return !!el && getComputedStyle(el).display !== "none"; }, sel);

  test("holds search, the blue new-card button and the vault", async () => {
    await openVault({ viewport: { width: 1280, height: 800 } });
    for (const sel of [".sb-search", ".sb-new", ".sb-account"]) assert.equal(await shown(sel), true, sel);
    assert.match(await page().textContent(".sb-account"), /Demo|vault/i);
    // the sidebar runs the full height, the board starts to its right
    const box = await ev(() => ({ side: $(".sn-side").getBoundingClientRect().toJSON(), main: $(".sn-main").getBoundingClientRect().toJSON() }));
    assert.equal(box.side.top, 0);
    assert.ok(box.main.left >= box.side.right - 1);
    noErrors();
  });

  test("the sidebar search opens the card picker", async () => {
    await openVault();
    await page().click(".sb-search");
    assert.equal(await ev(() => !!document.activeElement?.closest(".prompt") && document.activeElement.getAttribute("aria-label") === t("pickCard")), true);
    noErrors();
  });

  test("Settings has no style or font choice, and old saved choices are dropped", async () => {
    await openVault();
    await H.page.addInitScript(() => { try { localStorage.setItem("sn-ui", JSON.stringify({ lang: "en", style: "workbench", font: "plex", writeFont: "serif" })); } catch { /* file:// storage */ } });
    await H.page.reload();
    assert.deepEqual(await ev(() => [UI.style, UI.font, UI.writeFont, /\b(font|write)-/.test(document.body.className)]), [undefined, undefined, undefined, false]);
    assert.equal(await ev(() => document.body.classList.contains("sn-app")), true);
    await ev(() => settingsModal("appearance"));
    const interfaceRows = await page().$$eval(".sn-set-body .sn-set-group:first-of-type .setting-item-name", (n) => n.map((x) => x.textContent));
    assert.deepEqual(interfaceRows, ["Language", "Theme"], "the interface is language and theme only");
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /font/i);
  });

  test("the command palette is a popup with keys written out, not a minibuffer prompt", async () => {
    await openVault();
    await page().keyboard.press("Control+p");
    await page().waitForSelector(".prompt .prompt-input");
    assert.equal(await page().$eval(".prompt-input", (i) => i.placeholder), "Type a command…");
    const keys = await page().$$eval(".prompt .suggestion-keys", (r) => r.map((x) => [...x.querySelectorAll("kbd")].map((k) => k.textContent).join("+")));
    const want = await ev(() => [["Ctrl", "O"], ["Ctrl", "Shift", "D"]].map((k) => k.map(keyName).join("+")));
    assert.ok(want.every((k) => keys.includes(k)), keys.join(", "));
    assert.ok(!keys.some((k) => /\b[CMS]-|RET|SPC/.test(k)), "no Emacs-style key names");
    await page().fill(".prompt-input", "keyboard shortcuts");
    await page().keyboard.press("Enter");
    assert.equal(await page().textContent(".modal .sn-set-tab.is-active"), "Keyboard shortcuts", "the shortcuts are a section of the settings");
    assert.equal(await page().$$eval(".sn-set-body .suggestion-keys kbd", (k) => k.length > 20), true, "the shortcuts list uses the same key chips");
    noErrors();
  });

  test("keys are written ⌘ ⌥ ⇧ on a Mac and Ctrl Alt Shift elsewhere", async () => {
    await openVault();
    const r = await ev(() => ({ mac: IS_MAC, name: keyName("Ctrl"), text: keyText("Ctrl+Shift+D · Alt+↑") }));
    assert.deepEqual([r.name, r.text], r.mac ? ["⌘", "⌘⇧D · ⌥↑"] : ["Ctrl", "Ctrl+Shift+D · Alt+↑"]);
  });

  test("the palette puts the last commands run first and ticks the settings that are on", async () => {
    await openVault();
    const open = async () => { await page().keyboard.press("Control+p"); await page().waitForSelector(".prompt .prompt-input"); };
    await open();
    assert.equal(await page().$$eval(".suggestion-group", (g) => g.length), 0, "no Recent group before any command was run");
    const ticked = await page().$$eval(".prompt .suggestion-item", (r) => r.filter((x) => x.querySelector(".suggestion-check")).map((x) => x.querySelector(".suggestion-title").textContent));
    assert.ok(ticked.includes("Depth: 1") && ticked.includes("Sidebar"), ticked.join(", "));
    assert.ok(!ticked.includes("Group by parent"));
    await page().fill(".prompt-input", "group by parent");
    await page().keyboard.press("Enter");
    await open();
    const r = await page().$$eval(".prompt-results > *", (els) => els.slice(0, 3).map((e) => [e.className, e.textContent]));
    assert.match(r[0][0], /suggestion-group/); assert.equal(r[0][1], "Recent");
    assert.equal(r[1][1], "Group by parent");
    assert.ok(await page().$eval(".prompt .suggestion-item", (x) => !!x.querySelector(".suggestion-check")), "now ticked");
    await page().fill(".prompt-input", "dep");
    assert.equal(await page().$$eval(".suggestion-group", (g) => g.length), 0, "no groups while typing");
    noErrors();
  });

  test("text and date prompts are popups too, and the date popup shows its calendar", async () => {
    await openVault();
    const name = ev(() => promptModal("Name"));
    await page().waitForSelector(".prompt.mod-ask .prompt-input");
    assert.equal(await page().textContent(".prompt.mod-ask .prompt-title"), "Name");
    await page().keyboard.type("Hello");
    await page().keyboard.press("Enter");
    assert.equal(await name, "Hello");
    const date = ev(() => orgAskDate("Schedule", null).then((r) => r && r.dn));
    await page().waitForSelector(".prompt.mod-ask .org-cal");
    await page().keyboard.type("+1");
    assert.match(await page().textContent(".prompt-preview"), /^→ <\d{4}-\d\d-\d\d/);
    await page().keyboard.press("Enter");
    assert.equal(await date, await ev(() => onow().dn + 1));
    assert.equal(await page().$(".prompt"), null);
    noErrors();
  });
});

describe("the app", () => {
  test("starts in its last folder with the native parts on screen, without errors (0.21.0 showed a white screen)", async () => {
    await H.openNativeApp();
    assert.equal(await ev(() => !!window.__TAURI__ && SupstackApp.vault.fs.kind === "disk" && typeof keyText === "undefined"), true, "a native vault, and the exports are not globals");
    assert.ok(await page().isVisible(".wb-files"), "the Files button");
    assert.match(await page().textContent(".sn-board"), /Home/);
    await page().keyboard.press("Control+p");
    await page().waitForSelector(".prompt .prompt-input");
    noErrors();
  });
});

describe("git sync settings", () => {
  test("the access token is handed to the native side and never kept in the page's storage", async () => {
    const old = { remote: "https://example.com/notes.git", branch: "main", username: "git", token: "tok", authorName: "", authorEmail: "", auto: false, minutes: 5 };
    await H.openNativeApp({ storage: { "sn-git:/vault": old } });
    await page().waitForFunction(() => window.__invokes.some(([c]) => c === "plugin:vault|git_save_settings"));
    const saved = await ev(() => window.__invokes.find(([c]) => c === "plugin:vault|git_save_settings")[1].settings);
    assert.equal(saved.token, "tok", "the token an older version kept in the page moves to the repository's settings");
    const local = await ev(() => JSON.parse(localStorage.getItem("sn-git:/vault")));
    assert.equal(local.token, "", "and leaves the page's storage");
    assert.equal(local.remote, old.remote);
    noErrors();
  });
});

describe("phone layout", () => {
  beforeEach(() => openVault({ viewport: { width: 390, height: 800 } }));

  test("the board's toolbar fits a 360px phone, with depths 1, 2 and ∞", async () => {
    await page().setViewportSize({ width: 360, height: 760 });
    const r = await ev(() => { setLayout("notes"); setTarget("cards/History.md"); return { right: $(".sn-tools").getBoundingClientRect().right, depths: [...document.querySelectorAll(".sn-tools .sn-seg:first-child button")].map((b) => b.textContent) }; });
    assert.ok(r.right <= 360, `the tools end at ${r.right}px`);
    assert.deepEqual(r.depths, ["1", "2", "∞"]);
    noErrors();
  });

  test("the sidebar starts closed and the editor fills the screen", async () => {
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
    await ev(() => openEditor("cards/History.md"));
    const box = await page().locator("#editor").boundingBox();
    assert.ok(box.width >= 370, `editor width ${box.width}`);
    noErrors();
  });

  test("the note's text uses the editor's width, not the desktop margins", async () => {
    await ev(() => openEditor("cards/History.md"));
    const pad = await ev(() => { const s = getComputedStyle($(".sn-editor-page")); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight)]; });
    assert.ok(pad.every((p) => p <= 16), `side padding ${pad}`);
    const box = await page().locator(".sn-editor-page .cm-content").boundingBox();
    assert.ok(box.width >= 330, `text width ${box.width}`);
  });

  test("the sidebar opens as a drawer and closes on navigation", async () => {
    await ev(() => setSide(true));
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), false);
    await ev(() => setTarget("cards/History.md"));
    assert.equal(await ev(() => $("#app").classList.contains("side-closed")), true);
  });

  test("on a touch screen a table's + buttons stay under it and on its right, not piled up in a corner", async () => {
    await openVault({ demo: false, notes: { "cards/T.md": "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |" }, viewport: { width: 390, height: 800 }, touch: true });
    await ev(() => openEditor("cards/T.md", { focus: false }));
    await page().waitForSelector("#editor .sn-table-host");
    const r = await ev(() => {
      const box = (s) => $(`#editor ${s}`).getBoundingClientRect();
      return { coarse: matchMedia("(pointer: coarse)").matches, t: box(".sn-live table").toJSON(), row: box(".sn-table-add-row").toJSON(), col: box(".sn-table-add-col").toJSON() };
    });
    assert.ok(r.coarse, "the phone's hit areas apply");
    assert.ok(r.row.top >= r.t.bottom - 1 && r.row.width >= r.t.width - 2, `the row button runs along the bottom: ${JSON.stringify(r)}`);
    assert.ok(r.col.left >= r.t.right - 1 && r.col.height >= r.t.height - 2, `the column button runs along the right: ${JSON.stringify(r)}`);
    noErrors();
  });
});

describe("no note colors", () => {
  test("no color in the properties or on the board, and a color left in a note's frontmatter is an ordinary property", async () => {
    await openVault({ demo: false, notes: { "cards/Old.md": "---\ncolor: red\n---\nText\n" } });
    await ev(() => openEditor("cards/Old.md", { focus: false, wide: false }));
    const r = await ev(() => ({
      dots: document.querySelectorAll(".sn-color-dot").length, tinted: document.querySelectorAll("[data-color]").length,
      keys: [...document.querySelectorAll("#editor-props .sn-prop-key")].map((k) => k.textContent),
    }));
    assert.equal(r.dots, 0);
    assert.equal(r.tinted, 0);
    assert.ok(r.keys.includes("color"), "shown like any other property");
    noErrors();
  });
});

describe("list of notes", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBmgAA5BAQBnLwP9VQyO8wAAAABJRU5ErkJggg==";
  beforeEach(() => openVault({ notes: { "cards/Pics.md": "---\nparents: [\"[[History]]\"]\n---\nSome **photo** here\n\n![[pic.png]]\n" } }));
  const rows = () => ev(() => [...document.querySelectorAll("#board .sn-rows .sn-row")].map((r) => r.dataset.path.replace(/^cards\/|\.md$/g, "")));

  test("the notes layout lists the card's own note and its children, and opens the first child beside the list", async () => {
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    assert.deepEqual(await rows(), ["History", "Pics", "Roman Empire"]);
    const r = await ev(() => ({
      path: editor.path, wide: editor.wide, app: document.getElementById("app").className,
      list: document.querySelector(".sn-main").getBoundingClientRect().width, note: document.querySelector(".sn-editor").getBoundingClientRect().width,
      own: document.querySelector(".sn-row.is-own .sn-row-meta").textContent, snippet: document.querySelector('.sn-row[data-path="cards/Pics.md"] .sn-row-snippet').textContent,
      editing: document.querySelector(".sn-row.is-editing")?.dataset.path,
    }));
    assert.equal(r.path, "cards/Pics.md");
    assert.equal(r.wide, false);
    assert.match(r.app, /notes-layout/);
    assert.equal(Math.round(r.list), 380);
    assert.ok(r.note > 500, "the note takes the rest of the width");
    assert.match(r.own, /^This card/);
    assert.equal(r.snippet, "Some photo here");
    assert.equal(r.editing, "cards/Pics.md");
    noErrors();
  });

  test("a click or the arrow keys open a note beside the list; the card's own note opens there too", async () => {
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    await page().click('.sn-row[data-path="cards/Roman Empire.md"]');
    assert.equal(await ev(() => editor.path), "cards/Roman Empire.md");
    await page().keyboard.press("ArrowUp");
    assert.equal(await ev(() => editor.path), "cards/Pics.md");
    await page().keyboard.press("ArrowUp");
    assert.deepEqual(await ev(() => [editor.path, editor.wide, !!document.querySelector(".sn-board .sn-row.is-own")]), ["cards/History.md", false, true]);
    // Enter puts the caret in the note
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => !!document.activeElement.closest(".sn-editor"));
    noErrors();
  });

  test("the first image of a note is its thumbnail", async () => {
    await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); vault.fs.add("attachments/pic.png", new Blob([bin], { type: "image/png" })); await loadVault(vault.fs); }, PNG);
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    await page().waitForFunction(() => document.querySelector('.sn-row[data-path="cards/Pics.md"] .sn-row-thumb')?.naturalWidth === 2);
    assert.equal(await ev(() => document.querySelectorAll(".sn-row-thumb").length), 1);
    noErrors();
  });

  test("expanding the note hides the list, closing it gives the list the whole width, and other layouts close a note beside them", async () => {
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    await ev(() => document.querySelector(".sn-editor-head .clickable-icon:nth-child(2)").click());
    assert.deepEqual(await ev(() => [editor.wide, getComputedStyle(document.querySelector(".sn-main")).display]), [true, "none"]);
    await ev(() => document.querySelector(".sn-editor-head .clickable-icon:nth-child(2)").click());
    assert.equal(await ev(() => Math.round(document.querySelector(".sn-main").getBoundingClientRect().width)), 380);
    await ev(() => closeEditor());
    await page().waitForTimeout(50); // the closed note's row takes the focus back, which must not open it again
    assert.deepEqual(await ev(() => [editor.path, document.querySelector(".sn-main").getBoundingClientRect().width > 900]), [null, true]);
    await ev(() => openEditor("cards/Pics.md", { focus: false, wide: false }));
    await ev(() => setLayout("columns"));
    assert.deepEqual(await ev(() => [editor.path, document.getElementById("app").classList.contains("notes-layout")]), [null, false]);
    noErrors();
  });

  test("a search shows the part of the text that matches", async () => {
    await openVault({ notes: { "cards/Long.md": "intro " + "filler words ".repeat(40) + "the needle is here" } });
    await ev(() => { setLayout("notes"); board.filter = { query: "needle", tags: [], scope: "all" }; board.searchOpen = true; renderBoard(true); });
    const r = await ev(() => { const el = document.querySelector('.sn-row[data-path="cards/Long.md"] .sn-row-snippet'); return { text: el.textContent, mark: el.querySelector("mark")?.textContent }; });
    assert.match(r.text, /^…/);
    assert.equal(r.mark, "needle");
    noErrors();
  });

  test("on a phone the list fills the screen and a tap opens the note", async () => {
    await openVault({ viewport: { width: 390, height: 800 } });
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    assert.equal(await ev(() => editor.path), null, "nothing opens by itself over the list");
    await page().click('.sn-row[data-path="cards/Roman Empire.md"]');
    assert.equal(await ev(() => editor.path), "cards/Roman Empire.md");
    noErrors();
  });

  test("a note with children goes inside with its button or →, and ← comes back out on it", async () => {
    await ev(() => { setLayout("notes"); setTarget("cards/History.md"); });
    const r = await ev(() => ({ gap: getComputedStyle(document.querySelector(".sn-rows")).rowGap, enter: [...document.querySelectorAll(".sn-row.has-kids")].map((x) => x.dataset.path) }));
    assert.equal(r.gap, "6px");
    assert.deepEqual(r.enter, ["cards/Roman Empire.md"]);
    await page().click('.sn-row[data-path="cards/Roman Empire.md"] .sn-row-enter');
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    await page().keyboard.press("ArrowLeft");
    assert.deepEqual(await ev(() => [board.target, editor.path, document.activeElement.dataset.path]), ["cards/History.md", "cards/Roman Empire.md", "cards/Roman Empire.md"]);
    await page().keyboard.press("ArrowRight");
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    assert.ok(await ev(() => document.activeElement.classList.contains("sn-row")), "a row of the new list has the focus, so the arrows go on");
    noErrors();
  });
});

describe("editing a note that changes on disk", () => {
  beforeEach(() => openVault({ demo: false, notes: { "cards/A.md": "---\ntags: x\n---\nold\n" } }));
  const type = (text) => ev((text) => {
    openEditor("cards/A.md"); editor.mode = "source"; renderEditor();
    const ta = $(".sn-editor-text"); ta.value = text; editor.dirty = true;
  }, text);
  const changeOnDisk = (text) => ev(async (text) => {
    const p = "cards/A.md";
    await vault.fs.write(p, text);
    vault.notes.set(p, parseNote(p, text, Date.now()));
  }, text);

  test("unsaved typing is saved and the text from outside is kept beside it", async () => {
    await type("---\ntags: x\n---\nmine\n");
    await changeOnDisk("---\ntags: x\n---\ntheirs\n");
    await ev(() => saveEditor());
    assert.equal(await H.fsText("cards/A.md"), "---\ntags: x\n---\nmine\n");
    const copies = await ev(() => [...vault.notes.keys()].filter((p) => p.includes("(conflict ")));
    assert.equal(copies.length, 1, String(copies));
    assert.match(copies[0], /^cards\/A \(conflict \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\)\.md$/);
    assert.equal(await H.fsText(copies[0]), "---\ntags: x\n---\ntheirs\n");
    assert.match(await page().textContent(".sn-toast-text"), /changed outside the app/);
    // typing on goes on from the saved text, without another copy
    await ev(() => { const ta = $(".sn-editor-text"); ta.value = ta.value + "more\n"; editor.dirty = true; return saveEditor(); });
    assert.equal(await ev(() => [...vault.notes.keys()].filter((p) => p.includes("(conflict ")).length), 1);
    noErrors();
  });

  test("in the live editor too, with the frontmatter the typing started from", async () => {
    await ev(() => { openEditor("cards/A.md"); $(".sn-editor-text.is-live").value = "mine\n"; editor.dirty = true; });
    await changeOnDisk("---\ntags: y\n---\ntheirs\n");
    await ev(() => saveEditor());
    assert.equal(await H.fsText("cards/A.md"), "---\ntags: x\n---\nmine\n");
    const copy = await ev(() => [...vault.notes.keys()].find((p) => p.includes("(conflict ")));
    assert.equal(await H.fsText(copy), "---\ntags: y\n---\ntheirs\n");
    noErrors();
  });

  test("a save with nothing changed outside writes no copy, and a second copy gets its own name", async () => {
    await type("---\ntags: x\n---\nmine\n");
    await ev(() => saveEditor());
    assert.equal(await ev(() => [...vault.notes.keys()].length), 1);
    const names = await ev(() => { const d = new Date(2026, 10, 10, 10, 0, 0); const a = conflictPath("cards/A.md", d); vault.allPaths.add(a); const b = conflictPath("cards/A.md", d); vault.allPaths.add(b); return [a, b, conflictPath("cards/A.md", d)]; });
    assert.deepEqual(names, ["cards/A (conflict 2026-11-10 10.00.00).md", "cards/A (conflict 2026-11-10 10.00.00 2).md", "cards/A (conflict 2026-11-10 10.00.00 3).md"]);
    noErrors();
  });
});
