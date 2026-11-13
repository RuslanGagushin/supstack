// The list of notes and the sidebar: the board, navigation, search and selection, the notebooks tree, tags and recent notes.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev } from "./harness.mjs";
import * as H from "./harness.mjs";

const page = () => H.page;
// the notes the list shows, in order; checks that each one is on the page too
const titles = () => ev(() => {
  const shown = boardModel().shown.map((c) => c.path);
  const onPage = new Set([...document.querySelectorAll("#board .sn-rows .sn-card")].map((c) => c.dataset.path));
  return shown.filter((p) => onPage.has(p)).map((p) => p.replace(/^cards\/|\.md$/g, ""));
});
const noErrors = () => assert.equal(H.errors.length, 0, H.errors.map((e) => e.stack || e).join("\n"));

describe("board", () => {
  beforeEach(() => openVault());

  test("pressing a button, an icon button or a row shows: one step darker than hovering (spec DS-8)", async () => {
    const sel = await ev(() => { const s = document.createElement("span"); s.style.color = "var(--sel)"; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    for (const target of [".sb-nav button.sn-btn", ".sn-editor-head .clickable-icon", "#board .sn-rows .sn-card.sn-row"]) {
      const box = await page().locator(target).first().boundingBox();
      await page().mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 12));
      const hover = await ev((t) => getComputedStyle(document.querySelector(t)).backgroundColor, target);
      await page().mouse.down();
      await H.tick(30);
      const pressed = await ev((t) => getComputedStyle(document.querySelector(t)).backgroundColor, target);
      await page().mouse.move(1, 1);
      await page().mouse.up();
      assert.equal(pressed, sel, `${target} pressed`);
      assert.notEqual(pressed, hover, `${target}: pressing differs from hovering`);
    }
    noErrors();
  });

  test("the demo board shows the top-level notebooks, then the notes, each in manual order", async () => {
    const t = await titles();
    assert.deepEqual(t.slice(0, 4), ["History", "Architecture", "Knowledge", "This week"]);
    assert.ok(!t.includes("Roman Empire"), "children are not on the top level");
    noErrors();
  });

  test("open a notebook as the list: its title, no breadcrumbs, back and up; the open note's header has the path", async () => {
    await ev(() => setTarget("cards/Roman Empire.md"));
    assert.deepEqual(await titles(), ["Aqueducts", "Colosseum"], "Aqueducts holds Pont du Gard, so it comes first as a notebook");
    assert.equal(await page().textContent(".sn-list-title"), "Roman Empire");
    assert.equal(await ev(() => document.querySelectorAll("#board .sn-topbar .sn-crumb").length), 0, "no breadcrumbs above the list");
    assert.equal(await page().textContent("#editor .sn-editor-path"), "History/Roman Empire", "the note beside it names its notebooks, not itself");
    await page().keyboard.press("Alt+ArrowUp");
    assert.equal(await ev(() => board.target), "cards/History.md");
    await page().keyboard.press("Alt+ArrowLeft");
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    // nor above the agenda or Files: their titles say where they are
    for (const open of [() => openTasksView(), () => openFilesView()]) {
      await ev(open);
      assert.equal(await ev(() => document.querySelectorAll("#board .sn-topbar .sn-crumb").length), 0);
    }
    noErrors();
  });

  test("the board is the list of notes only: no layout switch, no masonry, no card grid settings", async () => {
    const r = await ev(() => ({
      layout: "layout" in board, notes: $("#app").classList.contains("notes-layout"), masonry: !!$(".sn-masonry"), hero: !!$(".sn-hero"),
      layoutButtons: $$(".sn-tools button").filter((b) => ["Columns", "List", "Notes beside the list"].includes(b.title)).length,
    }));
    assert.deepEqual(r, { layout: false, notes: true, masonry: false, hero: false, layoutButtons: 0 });
    await ev(() => settingsModal("appearance"));
    assert.doesNotMatch(await page().textContent(".sn-set-body"), /layout|card face|preview length|card height/i);
    noErrors();
  });

  test("a note opens beside the list; from the agenda it opens as a page", async () => {
    await ev(() => setTarget("cards/Roman Empire.md"));
    await ev(() => openEditor("cards/Colosseum.md"));
    assert.equal(await ev(() => editor.wide), false);
    await ev(() => { closeEditor(); openTasksView(); openEditor("cards/Colosseum.md"); });
    assert.equal(await ev(() => editor.wide), true);
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

  test("a parent cycle lists and searches without hanging", async () => {
    await ev(() => setTarget("cards/Cycle A.md"));
    assert.deepEqual(await titles(), ["Cycle B"]);
    await ev(() => { board.filter = { query: "cycle", tags: [], scope: "here" }; board.searchOpen = true; renderBoard(); });
    assert.deepEqual(await titles(), ["Cycle B"], "a search below the card goes round the cycle once");
    noErrors();
  });

  test("search filters the board, Escape closes it", async () => {
    await page().keyboard.press("Control+f");
    await page().keyboard.type("aqueduct");
    await page().waitForFunction(() => board.filter.query === "aqueduct" && document.querySelectorAll("#board .sn-rows .sn-card").length === 4);
    assert.deepEqual(await titles(), ["Aqueducts", "This week", "Roman Empire", "Pont du Gard"], "titles and text both match, the title first");
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
    await page().click(".modal .is-danger");
    await page().waitForFunction(() => !vault.notes.has("cards/Knowledge.md") && !vault.notes.has("cards/Draft thoughts.md"));
    await page().keyboard.press("Control+z");
    await page().waitForFunction(() => vault.notes.has("cards/Knowledge.md") && vault.notes.has("cards/Draft thoughts.md"));
  });
});

describe("list of notes", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBmgAA5BAQBnLwP9VQyO8wAAAABJRU5ErkJggg==";
  beforeEach(() => openVault({ notes: { "cards/Pics.md": "---\nparents: [\"[[History]]\"]\n---\nSome **photo** here\n\n![[pic.png]]\n" } }));
  const rows = () => ev(() => [...document.querySelectorAll("#board .sn-rows .sn-row")].map((r) => r.dataset.path.replace(/^cards\/|\.md$/g, "")));

  test("the list shows the notebook's own text under its title and its children below, and opens the first child beside it", async () => {
    await ev(() => setTarget("cards/History.md"));
    assert.deepEqual(await rows(), ["Roman Empire", "Pics"], "its notebooks, then its notes; its own text is not a row");
    const r = await ev(() => ({
      path: editor.path, wide: editor.wide, app: document.getElementById("app").className,
      list: document.querySelector(".sn-main").getBoundingClientRect().width, note: document.querySelector(".sn-editor").getBoundingClientRect().width,
      own: document.querySelector(".sn-list-head + .sn-list-desc")?.textContent, snippet: document.querySelector('.sn-row[data-path="cards/Pics.md"] .sn-row-snippet').textContent,
      editing: document.querySelector(".sn-row.is-editing")?.dataset.path, count: document.querySelector(".sn-list-count").textContent,
    }));
    assert.equal(r.path, "cards/Pics.md");
    assert.equal(r.wide, false);
    assert.match(r.app, /notes-layout/);
    assert.equal(Math.round(r.list), 360);
    assert.ok(r.note > 500, "the note takes the rest of the width");
    assert.match(r.own, /^Everything about the past/);
    assert.equal(r.count, "1 notebook · 1 note");
    assert.equal(r.snippet, "Some photo here");
    assert.equal(r.editing, "cards/Pics.md");
    noErrors();
  });

  test("a click or the arrow keys open a note beside the list; a notebook only takes the focus; the description opens the notebook's own note", async () => {
    await ev(() => setTarget("cards/History.md"));
    await page().click('.sn-row[data-path="cards/Pics.md"]');
    assert.equal(await ev(() => editor.path), "cards/Pics.md");
    await page().keyboard.press("ArrowUp");
    assert.deepEqual(await ev(() => [editor.path, document.activeElement.dataset.path]), ["cards/Pics.md", "cards/Roman Empire.md"], "the notebook doesn't open beside the list");
    await page().click(".sn-list-desc");
    assert.deepEqual(await ev(() => [editor.path, editor.wide, document.querySelector(".sn-list-desc").classList.contains("is-editing"), document.querySelectorAll(".sn-row.is-editing").length]),
      ["cards/History.md", false, true, 0], "it opens beside the list and is marked as the open one");
    // Enter on it puts the caret in the note
    await page().focus(".sn-list-desc");
    await page().keyboard.press("Enter");
    await page().waitForFunction(() => !!document.activeElement.closest(".sn-editor"));
    // typing in it updates the description, without redrawing the list
    await ev(async () => { document.querySelector(".sn-list-head").dataset.mark = "1"; const n = vault.notes.get("cards/History.md"); await writeRaw("cards/History.md", n.raw.replace("Everything about the past", "All of the past")); refresh(); });
    await page().waitForFunction(() => document.querySelector(".sn-list-desc")?.textContent.startsWith("All of the past"));
    assert.equal(await ev(() => document.querySelector(".sn-list-head").dataset.mark), "1", "the list was patched, not drawn again");
    noErrors();
  });

  test("the count says how many notebooks and notes the list holds, and a notebook with no text has no description", async () => {
    await openVault({ demo: false, notes: { "cards/A.md": "", "cards/B.md": "---\nparents: [\"[[A]]\"]\n---\n", "cards/C.md": "---\nparents: [\"[[B]]\"]\n---\nc",
      "cards/D.md": "---\nparents: [\"[[A]]\"]\n---\nd", "cards/E.md": "---\nparents: [\"[[A]]\"]\n---\ne" } });
    const count = () => page().textContent(".sn-list-count");
    await ev(() => setTarget("cards/A.md"));
    assert.equal(await count(), "1 notebook · 2 notes");
    assert.equal(await ev(() => document.querySelectorAll(".sn-list-desc").length), 0);
    await ev(() => setTarget("cards/B.md"));
    assert.equal(await count(), "1 note");
    await ev(() => setTarget(null));
    assert.equal(await count(), "1 notebook", "only notebooks: no \"0 notes\"");
    noErrors();
  });

  test("the first image of a note is its thumbnail", async () => {
    await ev(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); vault.fs.add("attachments/pic.png", new Blob([bin], { type: "image/png" })); await loadVault(vault.fs); }, PNG);
    await ev(() => setTarget("cards/History.md"));
    await page().waitForFunction(() => document.querySelector('.sn-row[data-path="cards/Pics.md"] .sn-row-thumb')?.naturalWidth === 2);
    assert.equal(await ev(() => document.querySelectorAll(".sn-row-thumb").length), 1);
    noErrors();
  });

  test("expanding the note hides the list, and closing it gives the list the whole width", async () => {
    await ev(() => setTarget("cards/History.md"));
    await ev(() => document.querySelector(".sn-editor-head .clickable-icon:nth-child(2)").click());
    assert.deepEqual(await ev(() => [editor.wide, getComputedStyle(document.querySelector(".sn-main")).display]), [true, "none"]);
    await ev(() => document.querySelector(".sn-editor-head .clickable-icon:nth-child(2)").click());
    assert.equal(await ev(() => Math.round(document.querySelector(".sn-main").getBoundingClientRect().width)), 360);
    await ev(() => closeEditor());
    await page().waitForTimeout(50); // the closed note's row takes the focus back, which must not open it again
    assert.deepEqual(await ev(() => [editor.path, document.querySelector(".sn-main").getBoundingClientRect().width > 900]), [null, true]);
    noErrors();
  });

  test("a search shows the part of the text that matches", async () => {
    await openVault({ notes: { "cards/Long.md": "intro " + "filler words ".repeat(40) + "the needle is here" } });
    await ev(() => { board.filter = { query: "needle", tags: [], scope: "all" }; board.searchOpen = true; renderBoard(true); });
    const r = await ev(() => { const el = document.querySelector('.sn-row[data-path="cards/Long.md"] .sn-row-snippet'); return { text: el.textContent, mark: el.querySelector("mark")?.textContent }; });
    assert.match(r.text, /^…/);
    assert.equal(r.mark, "needle");
    noErrors();
  });

  test("on a phone the list fills the screen, a tap on a notebook goes inside and a tap on a note opens it", async () => {
    await openVault({ viewport: { width: 390, height: 800 } });
    await ev(() => setTarget("cards/History.md"));
    assert.equal(await ev(() => editor.path), null, "nothing opens by itself over the list");
    await page().click('.sn-row[data-path="cards/Roman Empire.md"]');
    assert.deepEqual(await ev(() => [board.target, editor.path]), ["cards/Roman Empire.md", null]);
    await page().click('.sn-row[data-path="cards/Colosseum.md"]');
    assert.equal(await ev(() => editor.path), "cards/Colosseum.md");
    noErrors();
  });

  test("an empty notebook has no row of its own; the card a note sits in shows only in a search; a drop next to the other group can only go inside", async () => {
    await openVault({ demo: false, notes: {
      "cards/Work.md": "", "cards/Proton.md": "---\nparents: [\"[[Work]]\"]\n---\n", "cards/Radar.md": "---\nparents: [\"[[Proton]]\"]\n---\nradar",
      "cards/Invoice.md": "---\nparents: [\"[[Work]]\", \"[[Proton]]\"]\n---\nan invoice",
    } });
    await ev(() => setTarget("cards/Work.md"));
    const list = () => ev(() => [...document.querySelectorAll("#board .sn-rows .sn-row")].map((r) => [r.dataset.path.replace(/^cards\/|\.md$/g, ""), r.classList.contains("is-folder"), r.querySelector(".sn-row-parent")?.textContent ?? null]));
    assert.deepEqual(await list(), [["Proton", true, null], ["Invoice", false, null]], "no empty Work row; Invoice doesn't name Proton here");
    assert.equal(await ev(() => editor.path), "cards/Invoice.md", "the first note opens, not the notebook");
    await ev(() => { setTarget(null); board.filter = { query: "invoice", tags: [], scope: "here" }; board.searchOpen = true; renderBoard(); });
    assert.deepEqual(await list(), [["Invoice", false, "Work"]], "in a search it says which card each note sits in");
    await ev(() => setTarget("cards/Work.md"));
    const zones = await ev(() => {
      board.filter = { query: "", tags: [] }; board.searchOpen = false; renderBoard();
      const fire = (el, type) => { const dt = new DataTransfer(); const r = el.getBoundingClientRect(); el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + 2 })); };
      const folder = document.querySelector('.sn-row[data-path="cards/Proton.md"]'), note = document.querySelector('.sn-row[data-path="cards/Invoice.md"]');
      fire(note, "dragstart");
      fire(folder, "dragover");
      const r = [...folder.classList].filter((c) => c.startsWith("is-drop"));
      dnd.cleanup();
      return r;
    });
    assert.deepEqual(zones, ["is-drop-inside"], "a note dropped at a notebook's top edge goes into it, not between the notebooks");
    noErrors();
  });

  test("the note's header shows the notebooks it sits in and its other places; Move and Open notebook are in ⋮; no Children block", async () => {
    await openVault({ demo: false, notes: {
      "cards/Work.md": "", "cards/Proton.md": "---\nparents: [\"[[Work]]\"]\n---\n", "cards/Home.md": "",
      "cards/Invoice.md": "---\nparents: [\"[[Proton]]\", \"[[Home]]\"]\n---\nan invoice",
    } });
    await ev(() => openEditor("cards/Invoice.md", { focus: false, wide: false }));
    const head = () => ev(() => ({
      path: $(".sn-editor-path").textContent, links: $$(".sn-editor-path a.sn-editor-crumb").map((a) => a.textContent),
      places: $(".sn-editor-places")?.textContent ?? null, children: /Children/.test($("#editor").textContent),
    }));
    const menu = async () => { await page().click("#editor .sn-editor-more"); const items = await page().$$eval(".menu .menu-item", (xs) => xs.map((x) => x.textContent.trim())); await page().keyboard.press("Escape"); return items; };
    // of its two parents the path follows the first in manual order, as the list's breadcrumbs do
    assert.deepEqual(await head(), { path: "Home", links: ["Home"], places: "+1", children: false });
    const items = await menu();
    assert.ok(items.includes("Move to…"), "Move to… is in ⋮");
    assert.ok(!items.includes("Open notebook"), "a note with no notes inside has no Open notebook");
    await page().click(".sn-editor-places");
    assert.match(await page().textContent(".menu"), /Also in.*Work \/ Proton/s);
    await page().click(".menu .menu-item >> text=Work / Proton");
    assert.equal(await ev(() => board.target), "cards/Proton.md", "the other place opens its list");
    assert.deepEqual(await ev(() => [editor.path, $(".sn-editor-path").textContent]), ["cards/Invoice.md", "Work/Proton"], "the note stays open; its path now goes through the list's notebook");
    await page().click(".sn-editor-path a.sn-editor-crumb >> text=Work");
    assert.equal(await ev(() => board.target), "cards/Work.md", "a notebook in the path opens its list");
    await ev(() => openEditor("cards/Proton.md", { focus: false, wide: false }));
    assert.ok((await menu()).includes("Open notebook"), "a notebook opens as its list from ⋮");
    assert.equal(await ev(() => /Children/.test($("#editor").textContent)), false);
    await ev(() => openEditor("cards/Work.md", { focus: false, wide: false }));
    assert.equal(await page().textContent("#editor .sn-editor-path"), "All notes", "a note at the top sits in All notes");
    noErrors();
  });

  test("a notebook is a compact row that goes inside on a click or →, and ← comes back out on it", async () => {
    await ev(() => setTarget("cards/History.md"));
    const r = await ev(() => ({
      gap: getComputedStyle(document.querySelector(".sn-rows")).rowGap, folders: [...document.querySelectorAll(".sn-row.is-folder")].map((x) => x.dataset.path),
      row: document.querySelector(".sn-row.is-folder").textContent, snippet: !!document.querySelector(".sn-row.is-folder .sn-row-snippet"),
    }));
    assert.equal(r.gap, "6px");
    assert.deepEqual(r.folders, ["cards/Roman Empire.md"]);
    assert.equal(r.row, "Roman Empire2", "its name and how many cards it holds");
    assert.equal(r.snippet, false);
    await page().click('.sn-row[data-path="cards/Roman Empire.md"]');
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    await page().keyboard.press("ArrowLeft");
    assert.deepEqual(await ev(() => [board.target, editor.path, document.activeElement.dataset.path]), ["cards/History.md", "cards/Pics.md", "cards/Roman Empire.md"], "back on the notebook; the first note stays open beside");
    await page().keyboard.press("ArrowRight");
    assert.equal(await ev(() => board.target), "cards/Roman Empire.md");
    assert.ok(await ev(() => document.activeElement.classList.contains("sn-row")), "a row of the new list has the focus, so the arrows go on");
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

  test("the tree lists only notebooks, under the Notebooks heading, with how many cards each holds", async () => {
    await openVault({ demo: false, notes: {
      "cards/Work.md": "", "cards/Proton.md": "---\nparents: [\"[[Work]]\"]\n---\n", "cards/Radar.md": "---\nparents: [\"[[Proton]]\"]\n---\nradar",
      "cards/Invoice.md": "---\nparents: [\"[[Work]]\"]\n---\nan invoice", "cards/Loose.md": "a note with no notebook",
    } });
    const rows = () => ev(() => [...document.querySelectorAll("#tree .sn-aria-tree > .tree-item .sn-tree-row[data-path], #tree .sn-tree-children .sn-tree-row[data-path]")]
      .map((r) => [r.dataset.path.replace(/^cards\/|\.md$/g, ""), r.querySelector(".sn-tree-count")?.textContent ?? ""]));
    assert.match(await page().textContent("#tree .sn-tree-section.has-tools"), /^Notebooks/);
    assert.deepEqual(await rows(), [["Work", "2"]], "Loose and the notes inside Work are not in the tree");
    await ev(() => revealInTree("cards/Radar.md"));
    assert.deepEqual(await rows(), [["Work", "2"], ["Proton", "1"]], "revealing a note opens the notebooks it sits in; the note itself stays in the list");
    noErrors();
  });

  test("the notebooks come first in the sidebar, and Recent is last and folded", async () => {
    await openVault();
    const sections = () => ev(() => [...document.querySelectorAll("#tree .sn-tree-section")].map((s) => (s.querySelector(":scope > span:not(.sn-sec-caret):not(.sn-sec-count)") || s).textContent));
    assert.deepEqual(await sections(), ["Notebooks", "Tags", "Recent"]);
    assert.equal(await ev(() => document.querySelectorAll("#tree .sn-tree-row.is-recent").length), 0, "Recent starts folded");
    await page().click("#tree .sn-tree-section.is-toggle:last-of-type");
    assert.equal(await ev(() => document.querySelectorAll("#tree .sn-tree-row.is-recent").length), 5, "and opens on a click");
    assert.equal(await ev(() => UI.recentOpen), true);
    noErrors();
  });

  test("moving to a notebook from the list opens its branch in the tree and marks it", async () => {
    await openVault({ demo: false, notes: {
      "cards/Work.md": "", "cards/Proton.md": "---\nparents: [\"[[Work]]\"]\n---\n", "cards/Radar.md": "---\nparents: [\"[[Proton]]\"]\n---\n",
      "cards/Spec.md": "---\nparents: [\"[[Radar]]\"]\n---\na spec", "cards/Home.md": "", "cards/Lamp.md": "---\nparents: [\"[[Home]]\"]\n---\na lamp",
    } });
    const active = () => ev(() => [...document.querySelectorAll("#tree .sn-tree-row.is-active[data-path]")].map((r) => r.dataset.path));
    await ev(() => { tree.expanded.clear(); setTarget("cards/Work.md"); });
    await page().click('#board .sn-row.is-folder[data-path="cards/Proton.md"]');
    await page().click('#board .sn-row.is-folder[data-path="cards/Radar.md"]');
    assert.deepEqual(await active(), ["cards/Radar.md"], "the tree opened Work and Proton to show Radar");
    // a note from another notebook, opened beside this list: its notebook's row is marked, the list's stays current
    await ev(() => openEditor("cards/Lamp.md"));
    assert.deepEqual(await ev(() => [...document.querySelectorAll("#tree .sn-tree-row.is-holding")].map((r) => r.dataset.path)), ["cards/Home.md"]);
    // its notebook in a folded branch: the nearest row that shows takes the mark
    await ev(() => { setTarget(null); tree.expanded.clear(); renderTree(); openEditor("cards/Spec.md"); });
    assert.deepEqual(await ev(() => [...document.querySelectorAll("#tree .sn-tree-row.is-holding")].map((r) => r.dataset.path)), ["cards/Work.md"]);
    await ev(() => { setTarget("cards/Radar.md"); openEditor("cards/Spec.md"); });
    assert.equal(await ev(() => document.querySelectorAll("#tree .sn-tree-row.is-holding").length), 0, "a note of the list beside it marks nothing");
    await ev(() => { openEditor("cards/Lamp.md"); closeEditor(); });
    assert.equal(await ev(() => document.querySelectorAll("#tree .sn-tree-row.is-holding").length), 0, "nor does a closed note");
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
    assert.deepEqual(interfaceRows, ["Language", "Theme", "Open notes"], "the interface is language, theme and how notes open");
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
    const groups = await page().$$eval(".suggestion-group", (g) => g.map((x) => x.textContent));
    assert.equal(groups[0], "Go to", "commands come in groups; no Recent group before any command was run");
    assert.ok(!groups.includes("Recent"));
    const ticked = await page().$$eval(".prompt .suggestion-item", (r) => r.filter((x) => x.querySelector(".suggestion-check")).map((x) => x.querySelector(".suggestion-title").textContent));
    assert.ok(ticked.includes("Sidebar"), ticked.join(", "));
    assert.ok(!ticked.includes("Select mode"));
    assert.ok(!ticked.some((x) => /^Depth/.test(x)), "no depth commands");
    await page().fill(".prompt-input", "select mode");
    await page().keyboard.press("Enter");
    await open();
    const r = await page().$$eval(".prompt-results > *", (els) => els.slice(0, 3).map((e) => [e.className, e.textContent]));
    assert.match(r[0][0], /suggestion-group/); assert.equal(r[0][1], "Recent");
    assert.equal(r[1][1], "Select mode");
    assert.ok(await page().$eval(".prompt .suggestion-item", (x) => !!x.querySelector(".suggestion-check")), "now ticked");
    await page().fill(".prompt-input", "sel");
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

  test("a new date opens on today, picked and marked; the time is typed as text, the end shows once there is a start, and Enter accepts", async () => {
    await openVault();
    const r = ev(() => orgAskDate("Schedule", null));
    await page().waitForSelector(".prompt.mod-ask .org-cal");
    const state = () => ev(() => ({
      sel: $(".cal-day.is-selected")?.classList.contains("is-today") ?? false, today: $$(".cal-day.is-today").length,
      ok: !$(".cal-ok").disabled, end: !$(".cal-end").hidden, input: $(".prompt-input").value,
    }));
    assert.deepEqual(await state(), { sel: true, today: 1, ok: true, end: false, input: "" }, "today is picked, so OK works at once");
    const type = async (sel, text) => { await page().fill(sel, text); await page().press(sel, "Tab"); };
    await type(".cal-t.is-start", "2pm");
    assert.match(await page().inputValue(".prompt-input"), / 14:00$/);
    assert.equal((await state()).end, true, "with a start, the end can be set");
    await type(".cal-t.is-end", "1530");
    assert.match(await page().inputValue(".prompt-input"), / 14:00-15:30$/);
    await type(".cal-t.is-start", "25:99");
    assert.equal(await ev(() => $(".cal-t.is-start").getAttribute("aria-invalid") === "true"), true, "a time it can't read is marked");
    assert.match(await page().inputValue(".prompt-input"), / 14:00-15:30$/, "and changes nothing");
    await page().fill(".cal-t.is-start", "930");
    await page().press(".cal-t.is-start", "Enter");
    assert.deepEqual(await r.then((x) => [x.dn, x.time, x.end]), [await ev(() => onow().dn), 9 * 60 + 30, 15 * 60 + 30], "Enter in the time field takes the time and accepts");
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
