// A note open beside the list: opening it, reading and editing, the live preview, and a note that changes on disk while it is edited.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

describe("opening a note", () => {
  test("a note opens for reading; a double click, Enter, a new note and today's note open it for editing", async () => {
    await openVault({ openNotes: "read" });
    await ev(() => setTarget("cards/History.md"));
    const mode = () => ev(() => [editor.path?.replace(/^cards\/|\.md$/g, "") ?? null, editor.mode, !!document.querySelector("#editor .sn-reading")]);
    await page().click('.sn-row[data-path="cards/Roman Empire.md"]');
    await page().click('.sn-row[data-path="cards/Colosseum.md"]');
    assert.deepEqual(await mode(), ["Colosseum", "read", true], "a click opens to read");
    await page().dblclick('.sn-row[data-path="cards/Colosseum.md"]');
    assert.deepEqual((await mode()).slice(0, 2), ["Colosseum", "edit"], "a double click on the open note switches it to editing");
    await page().click(".sn-list-desc"); // Roman Empire's own text, under the list's title
    assert.deepEqual((await mode()).slice(0, 2), ["Roman Empire", "read"], "the next note opens to read again");
    await page().focus(".sn-list-desc");
    await page().keyboard.press("Enter");
    assert.equal((await mode())[1], "edit", "Enter opens it to edit");
    await ev(() => createCard("Fresh", "cards/Roman Empire.md", "", undefined, { open: true }));
    assert.deepEqual((await mode()).slice(0, 2), ["Fresh", "edit"], "a new note opens to edit");
    await ev(() => openToday());
    assert.equal((await mode())[1], "edit", "so does today's note");
    noErrors();
  });

  test("reading shows one line under the title in place of Properties: when it changed, its tags, a missing notebook", async () => {
    await openVault({ openNotes: "read", demo: false, notes: { "cards/Doc.md": "---\nparents: [\"[[Gone]]\"]\ntags: [alpha, beta]\nicon: book\n---\nText\n", "cards/Other.md": "---\ntags: [alpha]\n---\n" } });
    await ev(() => openEditor("cards/Doc.md", { focus: false, wide: false }));
    const r = await ev(() => ({
      props: document.querySelectorAll("#editor-props .sn-props").length, line: document.querySelector("#editor-props .sn-info")?.textContent,
      tags: [...document.querySelectorAll(".sn-info .sn-info-tag")].map((x) => x.textContent), missing: document.querySelector(".sn-info .sn-chip.is-missing")?.textContent,
    }));
    assert.equal(r.props, 0, "no Properties while reading");
    assert.match(r.line, /^Modified /);
    assert.deepEqual(r.tags, ["#alpha", "#beta"]);
    assert.equal(r.missing, "Gone");
    await page().click(".sn-info .sn-info-tag");
    assert.deepEqual(await ev(() => [board.tagView, boardModel().shown.map((c) => c.path).sort()]), ["alpha", ["cards/Doc.md", "cards/Other.md"]], "a tag opens its list");
    await ev(() => openEditor("cards/Doc.md", { focus: false, edit: true }));
    assert.deepEqual(await ev(() => [document.querySelectorAll("#editor-props .sn-props").length, document.querySelectorAll("#editor-props .sn-info").length]), [1, 0], "editing shows Properties again");
    noErrors();
  });

  test("the header has Edit (Done while editing) and ⋮; the title stays put; outline, focus and source are in ⋮", async () => {
    await openVault({ openNotes: "read" });
    await ev(() => openEditor("cards/This week.md", { focus: false, wide: false }));
    const head = () => ev(() => ({
      mode: editor.mode, btn: $("#editor .sn-mode-btn")?.textContent, icons: $$("#editor .sn-editor-head > .clickable-icon").length,
      top: Math.round($("#editor .sn-inline-title").getBoundingClientRect().top),
    }));
    const read = await head();
    assert.deepEqual([read.mode, read.btn, read.icons], ["read", "Edit", 3], "close, expand and ⋮ besides Edit");
    await page().click("#editor .sn-mode-btn");
    const edit = await head();
    assert.deepEqual([edit.mode, edit.btn], ["edit", "Done"]);
    assert.equal(edit.top, read.top, "the title doesn't move when the toolbar comes in");
    await page().click("#editor .sn-mode-btn");
    const back = await head();
    assert.deepEqual([back.mode, back.top], ["read", read.top], "nor when it goes back to reading");
    // ⋮: the view first, the note's own actions after it, without "Edit"
    await page().click("#editor .sn-editor-more");
    const items = await page().$$eval(".menu .menu-item", (xs) => xs.map((x) => x.textContent.trim()));
    assert.deepEqual(items.slice(0, 3), ["Outline", "Focus mode", "Source mode (whole file)"]);
    assert.ok(!items.includes("Edit"));
    await page().click(".menu .menu-item >> text=Source mode");
    assert.equal(await ev(() => editor.mode), "source");
    await page().click("#editor .sn-mode-btn");
    assert.equal(await ev(() => editor.mode), "read", "Done from the source goes back to reading");
    noErrors();
  });

  test("on a phone the header says only \"‹ notebook\", which goes back to its list; the note's other places are in ⋮", async () => {
    await openVault({ demo: false, viewport: { width: 390, height: 800 }, notes: {
      "cards/Work.md": "", "cards/Proton.md": "---\nparents: [\"[[Work]]\"]\n---\n", "cards/Home.md": "", "cards/Top.md": "at the top",
      "cards/Invoice.md": "---\nparents: [\"[[Proton]]\", \"[[Home]]\"]\n---\nan invoice",
    } });
    await ev(() => setTarget("cards/Proton.md"));
    await page().click('.sn-row[data-path="cards/Invoice.md"]');
    const shownIn = (sel) => ev((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== "none"; }, sel);
    assert.equal(await page().textContent("#editor .sn-editor-back"), "Proton");
    assert.deepEqual([await shownIn("#editor .sn-editor-back"), await shownIn("#editor .sn-editor-path"), await shownIn("#editor .sn-editor-places"), await shownIn("#editor .sn-editor-close")],
      [true, false, false, false], "no path, +N or ×");
    await page().click("#editor .sn-editor-more");
    assert.match(await page().textContent(".menu"), /Also in.*Home/s);
    await page().keyboard.press("Escape");
    await page().click("#editor .sn-editor-back");
    assert.deepEqual(await ev(() => [editor.path, board.target]), [null, "cards/Proton.md"], "it closes the note onto its notebook's list");
    await ev(() => { setTarget(null); openEditor("cards/Top.md", { focus: false }); });
    assert.equal(await page().textContent("#editor .sn-editor-back"), "All notes", "a note at the top goes back to All notes");
    noErrors();
  });

  test("Settings › Open notes: For editing opens notes for editing", async () => {
    await openVault({ openNotes: "read" });
    await ev(() => settingsModal("appearance"));
    await page().selectOption(".sn-set-body select >> nth=2", "edit");
    await page().keyboard.press("Escape");
    assert.equal(await ev(() => JSON.parse(localStorage.getItem("sn-ui")).openNotes), "edit", "kept on this device");
    await ev(() => openEditor("cards/Colosseum.md", { focus: false, wide: false }));
    assert.equal(await ev(() => editor.mode), "edit");
    noErrors();
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
