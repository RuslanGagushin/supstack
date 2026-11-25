// A note open beside the list: opening it, reading and editing, the live preview, and a note that changes on disk while it is edited.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw, settle } from "./harness.mjs";
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

  test("nothing over the title: a notebook, a daily note and a note all open with the title first (restyle RS-39); the panel counts its tasks as a bar and words (RS-43)", async () => {
    const notes = { "cards/Book.md": "", "cards/Child.md": "---\nparents: [\"[[Book]]\"]\n---\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n", "daily notes/2026-11-13.md": "Today\n" };
    await openVault({ lang: "ru", openNotes: "read", demo: false, notes, viewport: { width: 1440, height: 900 } });
    for (const p of ["cards/Book.md", "cards/Child.md", "daily notes/2026-11-13.md"]) {
      await ev((p) => openEditor(p, { focus: false, wide: false }), p);
      assert.equal(await ev(() => document.querySelector("#editor .sn-editor-page").firstElementChild.classList.contains("sn-inline-title")), true, p);
    }
    await ev(() => openEditor("cards/Child.md", { focus: false, wide: false }));
    await settle();
    const r = await ev(() => {
      const line = document.querySelector("#editor .sn-insp [data-sec=tasks] .sn-insp-line"), bar = line.firstElementChild, fill = bar.firstElementChild;
      return { share: Math.round((fill.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100), words: line.lastElementChild.textContent };
    });
    assert.deepEqual(r, { share: 25, words: "1 из 4 выполнено" });
    noErrors();
  });

  test("no line of properties under the title, reading or editing: they live in the note's panel", async () => {
    await openVault({ openNotes: "read", demo: false, notes: { "cards/Doc.md": "---\ntags: [alpha, beta]\n---\nText\n" } });
    const shown = () => ev(() => getComputedStyle($("#editor-props")).display !== "none");
    await ev(() => openEditor("cards/Doc.md", { focus: false, wide: false }));
    assert.equal(await shown(), false, "reading");
    await ev(() => openEditor("cards/Doc.md", { focus: false, edit: true }));
    assert.equal(await shown(), false, "editing");
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
    assert.deepEqual([read.mode, read.btn, read.icons], ["read", "Edit", 4], "close, expand, the note's panel and ⋮ besides Edit");
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
    await page().keyboard.press(process.platform === "win32" ? "Control+y" : "ControlOrMeta+Shift+z");
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

  test("every state shows its icon; Ctrl+Enter ticks a box or unticks it, a plain line becomes one; no state menu", async () => {
    await ev(() => { const t = $(".sn-editor-text.is-live"); t.cmView.dispatch({ changes: { from: 0, to: t.value.length, insert: "- [/] b\n- [<] c\n- [-] f\n- [>] g\n- [x] d\nplain" } }); t.blur(); });
    assert.deepEqual(await ev(() => $$("#editor .task-box").map((b) => b.className.replace("task-box s-", ""))), ["doing", "wait", "cancel", "fwd", "done"]);
    assert.ok(await ev(() => !!$("#editor .cm-sn-task.s-cancel")), "a cancelled task's text is struck through");
    await caretAt((await value()).length);
    await page().keyboard.press("Control+Enter");
    assert.match(await value(), /\n- \[ \] plain$/);
    await page().keyboard.press("Control+Enter");
    assert.match(await value(), /\n- \[x\] plain$/, "a box in a note is open or done");
    await page().keyboard.press("Control+Enter");
    assert.match(await value(), /\n- \[ \] plain$/);
    assert.doesNotMatch(await value(), /CLOSED/, "and gets no CLOSED: line");
    await ev(() => $(".sn-editor-text.is-live").blur());
    await ev(() => $$("#editor .task-box")[4].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    assert.equal(await page().locator(".prompt .suggestion-item").count(), 0);
    await ev(() => $$("#editor .task-box")[4].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    await page().waitForFunction(() => $(".sn-editor-text.is-live").value.includes("- [ ] d\n"), null, { timeout: 5000 });
    noErrors();
  });

  test("Ctrl+C n turns the caret's line into a task of the agenda, linked to the note", async () => {
    await ev(() => { const t = $(".sn-editor-text.is-live"); t.cmView.dispatch({ changes: { from: 0, to: t.value.length, insert: "Intro\n- [ ] Call the museum\nOutro" } }); });
    await caretAt("Intro\n- [ ] Call".length);
    await page().keyboard.press("Control+c");
    await page().keyboard.press("n");
    await page().waitForFunction(() => orgAll().some((e) => e.title === "Call the museum"), null, { timeout: 5000 });
    await settle();
    const e = await ev(() => orgAll().find((x) => x.title === "Call the museum"));
    assert.equal(e.path, await ev(() => editor.path));
    assert.doesNotMatch(await value(), /Call the museum/);
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

describe("the note's panel", () => {
  const panel = () => ev(() => {
    const ed = $("#editor"), a = ed.querySelector(".sn-insp");
    const shown = !!a && getComputedStyle(a).display !== "none";
    return {
      shown, position: shown ? getComputedStyle(a).position : null,
      secs: shown ? [...a.querySelectorAll(".sn-insp-sec")].map((s) => s.dataset.sec) : [],
      facts: getComputedStyle($("#editor-props")).display !== "none",
      active: ed.querySelector(".sn-insp-btn").classList.contains("is-active"),
    };
  });
  test("on a wide window it is a column beside the note; the button hides it and it stays hidden", async () => {
    await openVault({ openNotes: "read", viewport: { width: 1440, height: 900 } });
    await ev(() => openEditor("cards/This week.md", { focus: false, wide: false }));
    await settle();
    let p = await panel();
    assert.deepEqual([p.shown, p.position, p.facts, p.active], [true, "static", false, true], "a column; no line of properties under the title");
    assert.deepEqual(p.secs, ["props", "tasks", "outline", "links", "info"]);
    assert.deepEqual(await ev(() => [$("#editor .sn-insp [data-sec=tasks] .sn-insp-count").textContent, $$("#editor .sn-insp .sn-insp-toc-item").map((b) => b.textContent)]),
      ["1/3", ["Packing"]], "the checklist's ticked boxes of all, and the note's headings");
    await ev(() => openEditor("cards/Aqueducts.md", { focus: false }));
    await settle();
    p = await panel();
    assert.deepEqual(p.secs, ["props", "links", "info"], "no tasks and no headings: those sections are left out");
    assert.match(await ev(() => $("#editor .sn-insp [data-sec=links]").textContent), /This week/, "the notes that link here");
    await page().click("#editor .sn-insp-btn");
    p = await panel();
    assert.deepEqual([p.shown, p.facts, p.active], [false, false, false], "hidden, and still no line under the title");
    assert.equal(await ev(() => UI.inspector), false, "kept for the next time");
    await ev(() => openEditor("cards/This week.md", { focus: false }));
    assert.equal((await panel()).shown, false, "another note opens without it");
    await page().click("#editor .sn-insp-btn");
    assert.equal((await panel()).shown, true);
    noErrors();
  });

  test("a section folds and stays folded; a heading in the outline goes to the note", async () => {
    await openVault({ openNotes: "read", viewport: { width: 1440, height: 900 } });
    await ev(() => openEditor("cards/This week.md", { focus: false, wide: false }));
    await settle();
    await page().click("#editor .sn-insp [data-sec=info] .sn-insp-sec-head");
    assert.deepEqual(await ev(() => [$("#editor .sn-insp [data-sec=info]").classList.contains("is-collapsed"), UI.inspFold]), [true, { info: true }]);
    await ev(() => renderEditor());
    assert.equal(await ev(() => $("#editor .sn-insp [data-sec=info]").classList.contains("is-collapsed")), true, "still folded after a redraw");
    await page().click("#editor .sn-insp .sn-insp-toc-item >> nth=0");
    await settle();
    noErrors();
  });

  test("a tag typed in the panel's Properties goes into the note's frontmatter", async () => {
    await openVault({ demo: false, notes: { "cards/Note.md": "---\ntags: [garden]\n---\nText\n" }, viewport: { width: 1440, height: 900 } });
    await ev(() => openEditor("cards/Note.md", { focus: false, wide: true }));
    await settle();
    await page().click("#editor .sn-insp .sn-prop-input");
    await page().keyboard.type("seeds");
    await page().keyboard.press("Enter");
    await settle();
    assert.match(await raw("cards/Note.md"), /tags:\n  - garden\n  - seeds\n/);
    assert.equal(await ev(() => document.activeElement === $("#editor .sn-insp .sn-prop-input")), true, "the input keeps the focus for the next tag");
    noErrors();
  });

  test("where the note's pane is narrow it lies over the text only while asked for; Esc closes it", async () => {
    await openVault({ openNotes: "read" });
    await ev(() => openEditor("cards/This week.md", { focus: false, wide: false }));
    await settle();
    let p = await panel();
    assert.deepEqual([p.shown, p.facts], [false, false], "no room for a column: it doesn't cover the text by itself");
    await page().click("#editor .sn-insp-btn");
    p = await panel();
    assert.deepEqual([p.shown, p.position, p.active], [true, "absolute", true], "over the text");
    await page().keyboard.press("Escape");
    assert.equal((await panel()).shown, false);
    assert.equal(await ev(() => editor.path), "cards/This week.md", "Esc closed the panel, not the note");
    noErrors();
  });

  test("on a phone it is a sheet from the bottom that the ⓘ button opens and the dim behind closes; nothing about the note sits under its title", async () => {
    await openVault({ openNotes: "read", viewport: { width: 390, height: 800 }, touch: true });
    await ev(() => openEditor("cards/Aqueducts.md", { focus: false }));
    await settle();
    let p = await panel();
    assert.deepEqual([p.shown, p.facts], [false, false], "no facts line under the title");
    assert.equal(await ev(() => getComputedStyle($("#editor-foot")).display), "none", "no mentions under the text");
    await page().tap("#editor .sn-insp-btn");
    p = await panel();
    assert.deepEqual([p.shown, p.position], [true, "fixed"]);
    const box = await page().locator("#editor .sn-insp").boundingBox();
    assert.ok(Math.abs(box.y + box.height - 800) < 2 && box.width === 390, "along the bottom edge, the screen's width");
    await page().mouse.click(195, 40); // the dim above the sheet
    assert.equal((await panel()).shown, false);
    await ev(() => openEditor("cards/Aqueducts.md", { focus: false, edit: true }));
    await settle();
    assert.equal((await panel()).facts, false, "editing has no Properties block under the title either");
    noErrors();
  });
});

describe("the side panel's properties (#26)", () => {
  test("plain values in the panel's type, a known colour with a swatch, a list as YAML", async () => {
    await openVault({ demo: false, viewport: { width: 1440, height: 900 }, notes: { "cards/Props.md": "---\ncolor: green\norder: 3\ncategory: Week\naliases: [a, b]\n---\nText\n" } });
    await ev(() => { openEditor("cards/Props.md"); if (!document.querySelector(".sn-insp")) toggleInspector(); });
    await H.page.waitForTimeout(300);
    const m = await ev(() => {
      const val = (k) => [...document.querySelectorAll(".sn-insp .sn-prop")].find((r) => r.querySelector(".sn-prop-key").textContent === k)?.querySelector(".sn-prop-val");
      const font = (el) => getComputedStyle(el).fontFamily;
      const body = font(document.querySelector(".sn-insp .sn-prop-key"));
      return { body, color: font(val("color").querySelector(".sn-prop-other")), order: font(val("order").querySelector(".sn-prop-other")), aliases: font(val("aliases").querySelector(".sn-prop-other")), swatch: !!val("color").querySelector(".sn-prop-swatch.hue-green"), noSwatch: !val("category").querySelector(".sn-prop-swatch") };
    });
    assert.equal(m.color, m.body, JSON.stringify(m));
    assert.equal(m.order, m.body, JSON.stringify(m));
    assert.notEqual(m.aliases, m.body, `a list stays as YAML: ${JSON.stringify(m)}`);
    assert.ok(m.swatch && m.noSwatch, JSON.stringify(m));
  });
});
