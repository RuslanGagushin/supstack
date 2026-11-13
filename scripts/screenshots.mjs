// Takes the README screenshots in docs/screenshots/ from the demo vault, in headless Chrome.
// Run: npm run screenshots (builds the page first). Set CHROME_PATH to use another Chromium.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, devices } from "playwright-core";
import { PAGE, buildPage } from "./page.mjs";

const OUT = join(PAGE, "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
buildPage();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });

async function open(theme = "light", options = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }) {
  const page = await browser.newPage({ ...options, locale: "en-US" });
  await page.addInitScript((theme) => {
    window.__SN_EXPOSE__ = true;
    try { localStorage.clear(); localStorage.setItem("sn-ui", JSON.stringify({ lang: "en", theme })); } catch { /* file:// storage */ }
  }, theme);
  await page.goto(pathToFileURL(PAGE).href);
  await page.evaluate(() => loadVault(demoVault()));
  await page.waitForTimeout(800);
  return page;
}
async function shot(page, name, action) {
  if (action) { await page.evaluate(action); await page.waitForTimeout(800); }
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
  console.log(`docs/screenshots/${name}`);
}

await shot(await open("light"), "board-light.png");
await shot(await open("dark"), "board-dark.png");
// a note opens for reading; the same note being edited shows the toolbar and the Markdown
await shot(await open(), "editor.png", () => openEditor("cards/This week.md", { focus: false, wide: true }));
await shot(await open(), "editor-editing.png", () => openEditor("cards/This week.md", { focus: false, wide: true, edit: true }));
await shot(await open(), "agenda.png", () => openTasksView());
// a notebook with all three parts of a list: its own text, a notebook inside it (Aqueducts) and a note (Colosseum)
await shot(await open(), "notes-layout.png", () => setTarget("cards/Roman Empire.md"));
await shot(await open("light", devices["Pixel 7"]), "phone-board.png");
await shot(await open("light", devices["Pixel 7"]), "phone-editor.png", () => openEditor("cards/Aqueducts.md"));
await shot(await open("light", devices["Pixel 7"]), "phone-agenda.png", () => openTasksView());
await shot(await open("dark"), "editor-dark.png", () => openEditor("cards/This week.md", { focus: false, wide: true }));
await browser.close();
