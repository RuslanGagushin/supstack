// Visual check: eight key screens of the demo vault, in headless Chrome, against the pictures in tests/visual/.
//   npm run visual              compares; exits 1 and writes <name>.diff.png (red = changed) next to the baseline when a screen moved
//   npm run visual -- --update  takes the pictures again (do it when a change to the look is meant, and look at the result)
// Not part of `npm test`: pixels depend on the machine's fonts, so the pictures are for the machine that made them and this is a local
// step of the release checklist (RELEASING.md). On another machine, run --update once first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, devices } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { PAGE, buildPage } from "./page.mjs";

const DIR = join(PAGE, "..", "..", "tests", "visual");
const UPDATE = process.argv.includes("--update");
const MAX_CHANGED = 40; // pixels allowed to differ: a rerun on one machine is exact, so even a corner or a 1px shift shows
const NOW = new Date("2026-11-17T10:00:00"); // the demo vault is dated relative to now; freeze it so the pictures are the same every day
mkdirSync(DIR, { recursive: true });
buildPage();

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const phone = { ...devices["Pixel 7"], deviceScaleFactor: 1 };
const SCREENS = [
  { name: "board-light", theme: "light", opts: desktop },
  { name: "board-dark", theme: "dark", opts: desktop },
  { name: "note-light", theme: "light", opts: desktop, go: () => openEditor("cards/This week.md", { focus: false, wide: true }) },
  { name: "agenda-light", theme: "light", opts: desktop, go: () => openTasksView() },
  { name: "agenda-dark", theme: "dark", opts: desktop, go: () => openTasksView() },
  { name: "phone-board-light", theme: "light", opts: phone },
  { name: "phone-agenda-light", theme: "light", opts: phone, go: () => openTasksView() },
  { name: "phone-note-dark", theme: "dark", opts: phone, go: () => openEditor("cards/Aqueducts.md") },
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
let failed = 0;
for (const { name, theme, opts, go } of SCREENS) {
  const page = await browser.newPage({ ...opts, locale: "en-US" });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((theme) => {
    window.__SN_EXPOSE__ = true;
    try { localStorage.clear(); localStorage.setItem("sn-ui", JSON.stringify({ lang: "en", theme })); } catch { /* file:// storage */ }
  }, theme);
  await page.goto(pathToFileURL(PAGE).href);
  await page.evaluate(() => loadVault(demoVault()));
  await page.waitForTimeout(600);
  if (go) { await page.evaluate(go); await page.waitForTimeout(600); }
  const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
  await page.close();

  const file = join(DIR, `${name}.png`);
  if (UPDATE || !existsSync(file)) { writeFileSync(file, shot); console.log(`${UPDATE ? "updated" : "new"}  ${name}`); continue; }
  const was = PNG.sync.read(readFileSync(file));
  const now = PNG.sync.read(shot);
  if (was.width !== now.width || was.height !== now.height) { failed++; console.log(`FAIL  ${name}: size ${was.width}x${was.height} became ${now.width}x${now.height}`); continue; }
  const diff = new PNG({ width: was.width, height: was.height });
  const changed = pixelmatch(was.data, now.data, diff.data, was.width, was.height, { threshold: 0.1 });
  if (changed > MAX_CHANGED) {
    failed++;
    writeFileSync(join(DIR, `${name}.diff.png`), PNG.sync.write(diff));
    console.log(`FAIL  ${name}: ${changed} pixels changed (limit ${MAX_CHANGED}), see tests/visual/${name}.diff.png`);
  } else console.log(`ok    ${name}: ${changed} pixels changed`);
}
await browser.close();
if (failed) { console.log(`\n${failed} screen(s) moved. If that is the change you meant, run: npm run visual -- --update`); process.exit(1); }
