// Card actions: create, parents, drag and drop, icon, rename, delete, undo, tasks, daily notes, settings.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault, ev, raw, fsText } from "./harness.mjs";

const fmOf = (p) => ev((p) => vault.notes.get(p)?.fm ?? null, p);
const parentsOf = (p) => ev((p) => { setGraph(buildGraph()); return graph.parentsOf(p).sort(); }, p);
const NOTES = {
  "cards/Home.md": "---\nicon: house\n---\nThe home card. See [[Garden]] and [[cards/Garden|my garden]] and ![[Garden#Beds]].\n",
  "cards/Garden.md": '---\nparents:\n  - "[[Home]]"\n---\nBeds and trees.\n- [ ] water\n- [x] plant\n```\n- [ ] not a task\n```\n- [ ] weed\n',
  "cards/Shed.md": '---\nparents: ["[[Home]]"]\n---\nTools.\n',
  "cards/Tools/Saw.md": '---\nparents: ["[[Shed]]"]\n---\n',
  "cards/Templates/Plant.md": "---\nicon: sprout\ntags: [plant]\nchild_order: [\"[[x]]\"]\nparents: [\"[[Elsewhere]]\"]\nnote: \"{{title}} on {{date:YYYY}}\"\n---\n# {{title}}\nPlanted: {{date}}\n",
};

describe("create", () => {
  beforeEach(() => openVault({ demo: false, notes: NOTES }));

  test("a child card goes next to its parent and links it", async () => {
    const p = await ev(() => createCard("Roses", "cards/Garden.md", "red ones"));
    assert.equal(p, "cards/Roses.md");
    assert.equal(await raw(p), '---\nparents:\n  - "[[Garden]]"\n---\nred ones\n');
    assert.deepEqual(await parentsOf(p), ["cards/Garden.md"]);
  });

  test("names stay unique and clean; empty titles get a name", async () => {
    assert.equal(await ev(() => createCard("garden", "cards/Home.md")), "cards/garden 1.md", "cards/Garden.md exists: case-insensitive clash");
    assert.equal(await ev(() => createCard("a/b?", null)), "cards/a b.md");
    assert.equal(await ev(() => createCard("   ", null)), "cards/Untitled.md");
  });

  test("new cards go into cards/: next to a parent there, else at its top", async () => {
    assert.equal(await ev(() => createCard("Loose", null)), "cards/Loose.md");
    await ev(() => writeRaw("cards/Sub/Deep.md", ""));
    assert.equal(await ev(() => createCard("Child", "cards/Sub/Deep.md")), "cards/Sub/Child.md");
    await ev(() => writeRaw("daily notes/2026-11-05.md", ""));
    assert.equal(await ev(() => createCard("From the day", "daily notes/2026-11-05.md")), "cards/From the day.md", "a daily note's child goes into cards/");
  });

  test("a child template fills the new card but not its structure keys", async () => {
    await ev(() => setChildTemplate("cards/Garden.md", "cards/Templates/Plant.md"));
    assert.equal((await fmOf("cards/Garden.md")).child_template, "[[Plant]]");
    const p = await ev(() => createCard("Tulip", "cards/Garden.md", "", undefined, { tags: ["spring"] }));
    const year = String(new Date().getFullYear());
    assert.deepEqual(await fmOf(p), { parents: ["[[Garden]]"], icon: "sprout", tags: ["plant", "spring"], note: `Tulip on ${year}` });
    assert.match(await raw(p), /\n---\n# Tulip\nPlanted: \d{4}-\d\d-\d\d\n$/);
  });

  test("the composer creates a card on Enter, the first line is the title", async () => {
    await ev(() => setTarget("cards/Garden.md"));
    const page = (await import("./harness.mjs")).page;
    await page.fill(".sn-composer textarea", "Pond\nwith fish");
    await page.press(".sn-composer textarea", "Enter");
    await page.waitForFunction(() => vault.notes.has("cards/Pond.md"));
    assert.equal(await raw("cards/Pond.md"), '---\nparents:\n  - "[[Garden]]"\n---\nwith fish\n');
  });
});

describe("parents and moves", () => {
  beforeEach(() => openVault({ demo: false, notes: NOTES }));

  test("add and remove a parent; refuse cycles, self and duplicates", async () => {
    await ev(() => addParent("cards/Shed.md", "cards/Garden.md"));
    assert.deepEqual(await parentsOf("cards/Shed.md"), ["cards/Garden.md", "cards/Home.md"]);
    const before = await raw("cards/Home.md");
    await ev(() => addParent("cards/Home.md", "cards/Tools/Saw.md")); // Saw is under Home
    await ev(() => addParent("cards/Home.md", "cards/Home.md"));
    await ev(() => addParent("cards/Shed.md", "cards/Home.md"));
    assert.equal(await raw("cards/Home.md"), before);
    assert.deepEqual(await parentsOf("cards/Shed.md"), ["cards/Garden.md", "cards/Home.md"]);
    await ev(() => removeParent("cards/Shed.md", "cards/Home.md"));
    assert.deepEqual((await fmOf("cards/Shed.md")).parents, ["[[Garden]]"]);
    await ev(() => removeParent("cards/Shed.md", "cards/Garden.md"));
    assert.equal((await fmOf("cards/Shed.md")).parents, undefined, "the empty field is dropped");
  });

  test("drop: move, add a parent, take to the root", async () => {
    await ev(() => dropCards([{ child: "cards/Tools/Saw.md", from: "cards/Shed.md" }], "cards/Garden.md", true));
    assert.deepEqual(await parentsOf("cards/Tools/Saw.md"), ["cards/Garden.md"]);
    await ev(() => dropCards([{ child: "cards/Tools/Saw.md", from: "cards/Garden.md" }], "cards/Shed.md", false));
    assert.deepEqual(await parentsOf("cards/Tools/Saw.md"), ["cards/Garden.md", "cards/Shed.md"]);
    await ev(() => dropCards([{ child: "cards/Shed.md", from: "cards/Home.md" }], null, true));
    assert.deepEqual(await parentsOf("cards/Shed.md"), []);
  });

  test("drop refuses to nest a card in its own descendant", async () => {
    const before = await raw("cards/Home.md");
    await ev(() => dropCards([{ child: "cards/Home.md", from: null }], "cards/Tools/Saw.md", true));
    assert.equal(await raw("cards/Home.md"), before);
  });

  test("drop before a sibling writes child_order", async () => {
    await ev(() => dropCards([{ child: "cards/Shed.md", from: "cards/Home.md" }], "cards/Home.md", true, { path: "cards/Garden.md", pos: "before" }));
    assert.deepEqual((await fmOf("cards/Home.md")).child_order, ["[[Shed]]", "[[Garden]]"]);
    assert.deepEqual(await ev(() => { setGraph(buildGraph()); return graph.sortedChildren("cards/Home.md", manualCmp); }), ["cards/Shed.md", "cards/Garden.md"]);
  });

  test("drop at the root numbers the order field", async () => {
    await ev(() => dropCards([{ child: "cards/Garden.md", from: "cards/Home.md" }], null, true, { path: "cards/Home.md", pos: "before" }));
    assert.equal((await fmOf("cards/Garden.md")).order, 1);
    assert.equal((await fmOf("cards/Home.md")).order, 2);
  });

  test("icon on several cards", async () => {
    await ev(() => setIconFor(["cards/Home.md", "cards/Shed.md"], "hammer"));
    assert.equal(await ev(() => cardIcon("cards/Home.md")), "hammer");
    await ev(() => setIconFor(["cards/Home.md"], null));
    assert.equal((await fmOf("cards/Home.md")).icon, undefined);
    await ev(() => setIconFor(["cards/Shed.md"], "hammer"));
    assert.equal(await ev(() => cardIcon("cards/Shed.md")), "hammer");
  });

  test("a broken frontmatter is never overwritten", async () => {
    await ev(() => writeRaw("cards/Bad.md", "---\na: [\n---\nkeep me\n"));
    await ev(() => setIconFor(["cards/Bad.md"], "star"));
    assert.equal(await raw("cards/Bad.md"), "---\na: [\n---\nkeep me\n");
  });
});

describe("rename", () => {
  beforeEach(() => openVault({ demo: false, notes: NOTES }));

  test("renames the file and every link to it, keeping aliases and headings", async () => {
    await ev(async () => { S.pinned = ["cards/Garden.md"]; board.target = "cards/Garden.md"; });
    const np = await ev(() => renameCard("cards/Garden.md", "Yard"));
    assert.equal(np, "cards/Yard.md");
    assert.equal(await raw("cards/Home.md"), "---\nicon: house\n---\nThe home card. See [[Yard]] and [[Yard|my garden]] and ![[Yard#Beds]].\n");
    assert.equal(await fsText("cards/Garden.md"), null);
    assert.match(await fsText("cards/Yard.md"), /Beds and trees/);
    assert.deepEqual(await ev(() => [S.pinned, board.target]), [["cards/Yard.md"], "cards/Yard.md"]);
  });

  test("children keep their parent after it is renamed", async () => {
    await ev(() => renameCard("cards/Shed.md", "Barn"));
    assert.deepEqual(await parentsOf("cards/Tools/Saw.md"), ["cards/Barn.md"]);
  });

  test("refuses a name that exists", async () => {
    assert.equal(await ev(() => renameCard("cards/Shed.md", "garden")), "cards/Shed.md");
    assert.notEqual(await raw("cards/Shed.md"), null);
  });
});

describe("delete and undo", () => {
  beforeEach(() => openVault({ demo: false, notes: NOTES }));

  test("undo reverts a change, then nothing is left to undo", async () => {
    const before = await raw("cards/Shed.md");
    await ev(() => setIconFor(["cards/Shed.md"], "hammer"));
    await ev(() => undo());
    assert.equal(await raw("cards/Shed.md"), before);
    assert.equal(await ev(() => undoStack.length), 0);
  });

  test("undo removes a created card", async () => {
    await ev(() => createCard("Temp", null));
    await ev(() => undo());
    assert.equal(await raw("cards/Temp.md"), null);
    assert.equal(await fsText("cards/Temp.md"), null);
  });

  test("delete puts a copy in .trash on disk vaults, undo brings the card back", async () => {
    await ev(() => { vault.fs.kind = "disk"; });
    await ev(() => deleteCards(["cards/Shed.md"]));
    const st = await ev(async () => ({ gone: !vault.notes.has("cards/Shed.md"), trash: await vault.fs.read(".trash/Shed.md") }));
    await ev(() => { vault.fs.kind = "demo"; });
    assert.equal(st.gone, true);
    assert.match(st.trash, /Tools\./);
    await ev(() => undo());
    assert.match(await raw("cards/Shed.md"), /Tools\./);
  });

  test("deleting several cards asks first", async () => {
    const page = (await import("./harness.mjs")).page;
    const done = ev(() => deleteCards(["cards/Shed.md", "cards/Garden.md"]));
    await page.click(".modal .mod-warning");
    await done;
    assert.deepEqual(await ev(() => [vault.notes.has("cards/Shed.md"), vault.notes.has("cards/Garden.md")]), [false, false]);
  });

  test("the undo stack keeps the last 20 actions", async () => {
    await ev(async () => { for (let i = 0; i < 25; i++) await setIconFor(["cards/Shed.md"], i % 2 ? "hammer" : "star"); });
    assert.equal(await ev(() => undoStack.length), 20);
  });
});

describe("tasks, daily notes and settings", () => {
  beforeEach(() => openVault({ demo: false, notes: NOTES }));

  test("toggleTask ticks the n-th checkbox, skipping code blocks", async () => {
    await ev(() => toggleTask("cards/Garden.md", 2, true));
    assert.match(await raw("cards/Garden.md"), /- \[ \] water\n- \[x\] plant\n```\n- \[ \] not a task\n```\n- \[x\] weed\n/);
    await ev(() => toggleTask("cards/Garden.md", 1, false));
    assert.match(await raw("cards/Garden.md"), /- \[ \] plant/);
  });

  test("task progress on a card counts checkboxes", async () => {
    assert.deepEqual(await ev(() => cardTaskProgress("cards/Garden.md")), { done: 1, n: 3 });
    assert.equal(await ev(() => cardTaskProgress("cards/Shed.md")), null);
  });

  test("today's note is daily notes/YYYY-MM-DD.md, and a card", async () => {
    await ev(() => openToday());
    const name = await ev(() => formatMoment(new Date(), "YYYY-MM-DD"));
    const p = `daily notes/${name}.md`;
    assert.equal(await raw(p), "");
    assert.equal(await ev(() => editor.path), p);
    assert.equal(await ev((p) => isCard(p), p), true);
    await ev(() => openToday());
    assert.equal(await ev((p) => [...vault.notes.keys()].filter((x) => x === p).length, p), 1, "opening it again doesn't make a second note");
  });

  test("a vault on disk keeps its settings in .supstack/settings.json", async () => {
    await ev(async () => {
      vault.fs.kind = "disk";
      S.pinned = ["cards/Home.md"];
      await saveSettings();
      vault.fs.kind = "demo";
    });
    const data = JSON.parse(await fsText(".supstack/settings.json"));
    assert.deepEqual(data.pinned, ["cards/Home.md"]);
    assert.equal(data.defaultSort, "manual");
    assert.equal(data.defaultDepth, undefined, "the board has no depth any more");
    assert.equal(data.cardsFolder, undefined, "the folders are fixed, not settings");
  });

  test("settings from where versions up to 0.15 kept them move to .supstack/settings.json", async () => {
    await openVault({ demo: false, notes: { "cards/A.md": "a" } });
    const r = await ev(async () => {
      const fs = vault.fs;
      fs.kind = "disk";
      fs.add(".obsidian/plugins/supsidian/data.json", JSON.stringify({ pinned: ["cards/A.md"], defaultSort: "name", parentsField: "up", unknown: 1 }));
      await loadVault(fs);
      fs.kind = "demo";
      return { pinned: S.pinned, sort: S.defaultSort };
    });
    assert.deepEqual(r, { pinned: ["cards/A.md"], sort: "name" });
    const data = JSON.parse(await fsText(".supstack/settings.json"));
    assert.deepEqual([data.pinned, data.defaultSort, data.parentsField, data.unknown], [["cards/A.md"], "name", undefined, undefined], "settings that no longer exist are dropped");
  });

  test("a vault saved by a version with other board layouts and depths opens on the list of notes and drops their settings", async () => {
    await openVault({ demo: false, notes: { "cards/A.md": "a", "cards/B.md": "---\nparents: [\"[[A]]\"]\n---\nb" } });
    const r = await ev(async () => {
      const fs = vault.fs;
      fs.kind = "disk";
      fs.add(".supstack/settings.json", JSON.stringify({ pinned: [], defaultLayout: "columns", cardFace: "compact", previewLength: 200, cardMaxHeight: 100, defaultDepth: 0, defaultGrouped: true, defaultSort: "name" }));
      localStorage.setItem("sn-board:disk:" + fs.name, JSON.stringify({ target: "cards/A.md", layout: "columns", heroCollapsed: true, depth: 0, grouped: true, sort: "name" }));
      await loadVault(fs);
      await saveSettings();
      fs.kind = "demo";
      return {
        retired: ["defaultLayout", "cardFace", "previewLength", "cardMaxHeight", "defaultDepth", "defaultGrouped"].filter((k) => k in S), sort: S.defaultSort,
        board: [board.target, board.sort, ...["layout", "heroCollapsed", "depth", "grouped"].map((k) => k in board)],
        rows: [...document.querySelectorAll("#board .sn-rows .sn-row")].map((x) => x.dataset.path), notes: $("#app").classList.contains("notes-layout"),
      };
    });
    assert.deepEqual(r.retired, []);
    assert.equal(r.sort, "name", "the settings that stay are kept");
    assert.deepEqual(r.board, ["cards/A.md", "name", false, false, false, false]);
    assert.deepEqual(r.rows, ["cards/B.md"], "A's own text is the list's description, not a row");
    assert.equal(r.notes, true);
    const data = JSON.parse(await fsText(".supstack/settings.json"));
    assert.deepEqual(["defaultLayout", "cardFace", "previewLength", "cardMaxHeight", "defaultDepth", "defaultGrouped"].filter((k) => k in data), []);
  });

  test("notes outside the three folders move into cards/ on open, and pins, the board and links follow", async () => {
    await openVault({ demo: false, notes: {
      "cards/Home.md": "home", "Top.md": "---\nparents: [\"[[Home]]\"]\n---\nsee [[Projects/Plan]]", "Projects/Plan.md": "plan",
      "daily notes/2026-11-05.md": "day", "attachments/readme.md": "about the files",
    } });
    assert.deepEqual(await ev(() => [...vault.notes.keys()].sort()),
      ["attachments/readme.md", "cards/Home.md", "cards/Projects/Plan.md", "cards/Top.md", "daily notes/2026-11-05.md"]);
    assert.equal(await raw("cards/Top.md"), "---\nparents: [\"[[Home]]\"]\n---\nsee [[Projects/Plan]]", "the text is unchanged");
    assert.deepEqual(await ev(() => [graph.parentsOf("cards/Top.md"), resolveLink("Projects/Plan", "cards/Top.md")]), [["cards/Home.md"], "cards/Projects/Plan.md"]);
    assert.equal(await ev(() => isCard("attachments/readme.md")), false);
    // pins and the board follow on the next open
    const r = await ev(async () => {
      const fs = vault.fs;
      fs.add("Later.md", "later");
      S.pinned = ["Later.md"]; board.target = "Later.md"; persistBoard(); saveSettings();
      await loadVault(fs);
      return [S.pinned, board.target, vault.notes.has("cards/Later.md")];
    });
    assert.deepEqual(r, [["cards/Later.md"], "cards/Later.md", true]);
  });

});
