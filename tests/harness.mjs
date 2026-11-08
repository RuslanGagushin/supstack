// Shared setup for the page tests: the real web/supstack.html (built from web/src by npm test) in headless Chrome, with an in-memory vault.
// Each test file runs in its own process (node --test), so one browser per file.
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const PAGE = pathToFileURL(fileURLToPath(new URL("../web/supstack.html", import.meta.url))).href;
let browser;
export let page;
export let errors = [];

// the installed Chrome by default; CHROME_PATH points at any other Chromium
const launch = () => (browser ||= chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }));
after(async () => (await browser)?.close());

/**
 * A fresh page with a vault in memory.
 * - demo: start from the demo vault (default) or from an empty one
 * - notes: { path: raw text }, files: { path: { data, type, mtime } } (attachments)
 * - time: freeze the clock at this date (agenda and date tests)
 */
export async function openVault({ demo = true, notes = {}, files = {}, viewport = { width: 1280, height: 800 }, time = null, lang = "en" } = {}) {
  await page?.close();
  page = await (await launch()).newPage({ viewport, locale: lang === "ru" ? "ru-RU" : "en-US" });
  errors = [];
  page.setDefaultTimeout(15000); // six files run their browsers in parallel; a busy machine is slow
  page.on("pageerror", (e) => errors.push(e));
  if (time) await page.clock.setFixedTime(new Date(time));
  await page.addInitScript(({ lang }) => { window.__SN_EXPOSE__ = true; try { localStorage.clear(); localStorage.setItem("sn-ui", JSON.stringify({ lang })); } catch { /* file:// storage */ } }, { lang });
  await page.goto(PAGE);
  await page.evaluate(async ({ demo, notes, files }) => {
    const fs = demo ? demoVault() : new MemoryFS("Test vault", "demo");
    for (const [p, f] of Object.entries(files)) fs.add(p, new Blob([f.data ?? "x"], { type: f.type || "" }), f.mtime ?? Date.now());
    for (const [p, raw] of Object.entries(notes)) fs.add(p, raw);
    await loadVault(fs);
    for (const [p, f] of Object.entries(files)) { vault.sizes.set(p, (f.data ?? "x").length); vault.mtimes.set(p, f.mtime ?? Date.now()); }
    Object.assign(FV, { kind: "all", sort: "name", unused: false, query: "", sel: null });
  }, { demo, notes, files });
  return page;
}
export const ev = (fn, arg) => page.evaluate(fn, arg);
export const raw = (p) => ev((p) => vault.notes.get(p)?.raw ?? null, p);
export const fsText = (p) => ev(async (p) => { const f = vault.fs.files.get(p); return f ? (typeof f.data === "string" ? f.data : f.data.text()) : null; }, p);
export const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
/** Wait for the page's requestAnimationFrame refresh to land. */
export const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
export const SVG = { data: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>', type: "image/svg+xml" };

/**
 * The page as the Tauri app runs it: window.__TAURI__ answers the vault plugin from `notes` in memory, and the page
 * reopens the last folder on its own, the way the app starts. Native-only parts (the Files button, git sync) render.
 * The modules' exports are not globals here; window.SupstackApp gives the vault.
 */
export async function openNativeApp({ notes = { "Home.md": "# Home\n\n- TODO Write" }, viewport = { width: 1280, height: 800 } } = {}) {
  await page?.close();
  page = await (await launch()).newPage({ viewport, locale: "en-US" });
  errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e));
  await page.addInitScript((notes) => {
    // no __SN_EXPOSE__ here: it makes every export a global, which hides a missing import
    const files = { ...notes };
    const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const vault = {
      exists: (a) => a.path === "" || a.path in files,
      list: () => Object.keys(files).map((path) => ({ path, mtime: 1, size: files[path].length })),
      read: (a) => ({ data: a.binary ? b64(files[a.path]) : files[a.path], mtime: 1 }),
      write: (a) => { files[a.path] = a.text ?? atob(a.base64); return null; },
      remove: (a) => { delete files[a.path]; return null; },
      list_dir: () => [], remove_dir: () => null, git_info: () => ({ repo: false }), git_save_settings: () => null,
    };
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      const [plugin, c] = cmd.split("|");
      if (plugin !== "plugin:vault") return null;
      if (!vault[c]) throw new Error("no vault command " + c);
      return vault[c](a);
    } } };
    try { localStorage.clear(); localStorage.setItem("sn-ui", JSON.stringify({ lang: "en" })); localStorage.setItem("sn-native-last", JSON.stringify({ root: "/vault", name: "Vault" })); } catch { /* file:// storage */ }
  }, notes);
  await page.goto(PAGE);
  await page.waitForSelector("#board", { state: "attached" });
  return page;
}
