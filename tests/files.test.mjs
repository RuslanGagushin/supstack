// Files view (attachments): references, rename with link rewriting, delete, filters and the UI.
// Runs the real page in headless Chrome on the in-memory demo vault: `npm test`.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { openVault as open, ev, raw, tick as frame, SVG } from "./harness.mjs";
import * as H from "./harness.mjs";

let page, errors;
async function openVault(o) { page = await open(o); errors = H.errors; }
const refsOf = (p) => ev((p) => attachmentRefs().get(p) || [], p);

describe("references", () => {
  beforeEach(() => openVault({
    files: { "Att/car.svg": SVG, "Att/contract.pdf": { data: "%PDF" }, "Att/sub/car.svg": SVG, "Att/my file.txt": { data: "t" }, "orphan.zip": {} },
    notes: {
      "cards/A.md": "![[car.svg|300]]\n[[contract.pdf#page=2]]\n[txt](Att/my%20file.txt)\n",
      "cards/B.md": "```\n![[contract.pdf]]\n```\n[site](https://example.com/contract.pdf) ![[Att/sub/car.svg]]\n",
    },
  }));

  test("wiki embeds, wiki links and markdown links count; code and URLs don't", async () => {
    assert.deepEqual(await refsOf("Att/car.svg"), ["cards/A.md"]);
    assert.deepEqual(await refsOf("Att/contract.pdf"), ["cards/A.md"]);
    assert.deepEqual(await refsOf("Att/my file.txt"), ["cards/A.md"]);
    assert.deepEqual(await refsOf("Att/sub/car.svg"), ["cards/B.md"]);
    assert.deepEqual(await refsOf("orphan.zip"), []);
  });
});

describe("rename", () => {
  beforeEach(() => openVault({
    files: { "Att/car photo.svg": SVG, "Att/contract.pdf": { data: "%PDF" }, "Other/car.svg": SVG, "Att/taken.pdf": {} },
    notes: {
      "cards/A.md": "![[car photo.svg|300]] and [[contract.pdf#page=2|the contract]]\n![x](Att/car%20photo.svg)\n![y](<Att/car photo.svg>)\n",
      "cards/B.md": "unrelated [[car photo]] note link stays\n",
    },
  }));

  test("rewrites every link form and keeps aliases, sizes and anchors", async () => {
    const np = await ev(() => renameAttachment("Att/car photo.svg", "Mazda CX5"));
    assert.equal(np, "Att/Mazda CX5.svg", "the extension is kept");
    await ev(() => renameAttachment("Att/contract.pdf", "Signed.pdf"));
    assert.equal(await raw("cards/A.md"),
      "![[Mazda CX5.svg|300]] and [[Signed.pdf#page=2|the contract]]\n![x](Att/Mazda%20CX5.svg)\n![y](<Att/Mazda CX5.svg>)\n");
    assert.equal(await raw("cards/B.md"), "unrelated [[car photo]] note link stays\n");
    const st = await ev(() => ({ all: allAttachments().sort(), old: vault.files.has("car photo.svg"), exists: vault.fs.files.has("Att/car photo.svg"), data: vault.fs.files.has("Att/Mazda CX5.svg") }));
    assert.deepEqual(st.all, ["Att/Mazda CX5.svg", "Att/Signed.pdf", "Att/taken.pdf", "Other/car.svg"]);
    assert.equal(st.old, false, "the old name leaves the name index");
    assert.equal(st.exists, false);
    assert.equal(st.data, true);
    assert.deepEqual(await refsOf("Att/Mazda CX5.svg"), ["cards/A.md"]);
  });

  test("a name used elsewhere in the vault is linked by its full path", async () => {
    await ev(() => renameAttachment("Att/car photo.svg", "car.svg"));
    assert.match(await raw("cards/A.md"), /^!\[\[Att\/car\.svg\|300\]\]/);
    assert.deepEqual(await refsOf("Att/car.svg"), ["cards/A.md"]);
    assert.deepEqual(await refsOf("Other/car.svg"), []);
  });

  test("refuses a name that already exists in the folder", async () => {
    const before = await raw("cards/A.md");
    assert.equal(await ev(() => renameAttachment("Att/contract.pdf", "TAKEN.pdf")), "Att/contract.pdf");
    assert.equal(await raw("cards/A.md"), before);
    assert.equal(await ev(() => vault.allPaths.has("Att/contract.pdf")), true);
  });

  test("case-only rename and unsafe characters", async () => {
    assert.equal(await ev(() => renameAttachment("Att/contract.pdf", "Contract")), "Att/Contract.pdf");
    assert.equal(await ev(() => renameAttachment("Att/Contract.pdf", "a/b:c")), "Att/a b c.pdf");
    assert.equal(await ev(() => vault.fs.files.has("Att/Contract.pdf") || vault.fs.files.has("Att/contract.pdf")), false);
    assert.match(await raw("cards/A.md"), /\[\[a b c\.pdf#page=2\|the contract\]\]/);
  });

  test("the renamed image still shows", async () => {
    await ev(() => { openFilesView(); fvSelect("Att/car photo.svg"); });
    await ev(() => renameAttachment("Att/car photo.svg", "New"));
    await page.waitForFunction(() => document.querySelector(".fv-img")?.naturalWidth === 40);
    assert.equal(await page.textContent(".fv-crumb-name"), "New.svg");
  });
});

describe("delete", () => {
  beforeEach(() => openVault({ files: { "Att/used.svg": SVG, "Att/free.zip": { data: "zip" } }, notes: { "cards/A.md": "![[used.svg]]\n" } }));

  test("asks first, warns about links, cancel keeps the file", async () => {
    const done = ev(() => deleteAttachment("Att/used.svg"));
    assert.match(await page.textContent(".modal .modal-text"), /1 note links to it/);
    await page.click(".modal-buttons button:not(.mod-warning)");
    await done;
    assert.equal(await ev(() => vault.allPaths.has("Att/used.svg")), true);
  });

  test("moves the file to .trash on a disk vault", async () => {
    await ev(() => { vault.fs.kind = "disk"; });
    const done = ev(() => deleteAttachment("Att/free.zip"));
    await page.click(".modal .mod-warning");
    await done;
    const st = await ev(async () => ({ gone: !vault.allPaths.has("Att/free.zip") && !vault.fs.files.has("Att/free.zip"), name: vault.files.has("free.zip"), trash: await vault.fs.files.get(".trash/free.zip")?.data.text() }));
    await ev(() => { vault.fs.kind = "demo"; });
    assert.deepEqual(st, { gone: true, name: false, trash: "zip" });
  });
});

describe("list", () => {
  beforeEach(() => openVault({
    files: { "a.png": { data: "1234567890" }, "b.pdf": { data: "12" }, "c.mp3": { data: "123456" }, "d.zip": { data: "1" } },
    notes: { "cards/Holiday.md": "![[a.png]] [[b.pdf]]\n" },
  }));
  const rows = () => page.$$eval(".fv-row", (r) => r.map((x) => x.dataset.path));

  test("counts, kinds, unused, search and sort", async () => {
    await ev(() => openFilesView());
    assert.equal(await page.textContent(".fv-count"), "4");
    assert.equal(await page.textContent(".fv-total"), "Total size: 19 B");
    assert.deepEqual(await rows(), ["a.png", "b.pdf", "c.mp3", "d.zip"]);
    for (const [kind, want] of [["Images", ["a.png"]], ["PDF", ["b.pdf"]], ["Media", ["c.mp3"]], ["Other", ["d.zip"]], ["All", ["a.png", "b.pdf", "c.mp3", "d.zip"]]]) {
      await page.click(`.fv-kinds >> text=${kind}`);
      assert.deepEqual(await rows(), want, kind);
    }
    await page.click(".fv-unused");
    assert.deepEqual(await rows(), ["c.mp3", "d.zip"]);
    await page.click(".fv-unused");
    await page.fill(".fv-search", "holiday"); // by the name of the note that uses the file
    await page.waitForFunction(() => document.querySelectorAll(".fv-row").length === 2);
    assert.deepEqual(await rows(), ["a.png", "b.pdf"]);
    await page.fill(".fv-search", "");
    await page.waitForFunction(() => document.querySelectorAll(".fv-row").length === 4);
    await ev(() => { FV.sort = "size"; fvRenderList(); });
    assert.deepEqual(await rows(), ["a.png", "c.mp3", "b.pdf", "d.zip"]);
  });

  test("keyboard moves the selection; Go to note opens the note", async () => {
    await ev(() => openFilesView());
    await page.focus(".fv-list");
    await page.keyboard.press("ArrowDown");
    assert.equal(await ev(() => FV.sel), "a.png");
    assert.deepEqual(await ev(() => { const l = document.querySelector(".fv-list"), s = getComputedStyle(l); return [l.matches(":focus-visible"), s.outlineStyle, s.boxShadow]; }), [true, "none", "none"], "the list has keyboard focus but no frame; the selected row shows where you are");
    assert.equal(await page.isDisabled(".fv-goto"), false);
    await page.click(".fv-goto");
    assert.equal(await ev(() => editor.path), "cards/Holiday.md");
    await page.focus(".fv-list");
    await page.keyboard.press("End");
    assert.equal(await ev(() => FV.sel), "d.zip");
    assert.equal(await page.isDisabled(".fv-goto"), true, "an unused file has no note to go to");
    assert.match(await page.textContent(".fv-meta"), /Not used in any note/);
  });

  test("Back returns to the board, Ctrl+Shift+E toggles the view", async () => {
    await page.click("#files-btn");
    assert.equal(await ev(() => board.view), "files");
    assert.equal(await page.getAttribute("#files-btn", "class").then((c) => c.includes("is-active")), true);
    await page.click(".sn-topbar .sn-nav button");
    assert.equal(await ev(() => board.view), null);
    await page.keyboard.press("Control+Shift+E");
    assert.equal(await ev(() => board.view), "files");
    await frame();
    assert.equal(errors.length, 0, errors.join("\n"));
  });
});

describe("phone layout", () => {
  beforeEach(() => openVault({ files: { "a.svg": SVG }, viewport: { width: 375, height: 760 } }));

  test("list first, then the preview with a back arrow", async () => {
    await ev(() => openFilesView());
    assert.equal(await page.isVisible(".fv-preview"), false);
    await page.click(".fv-row");
    assert.equal(await page.isVisible(".fv-pane"), false);
    await page.waitForSelector(".fv-img", { state: "visible" });
    await page.click(".fv-close");
    assert.equal(await page.isVisible(".fv-pane"), true);
    assert.equal(errors.length, 0, errors.join("\n"));
  });
});
