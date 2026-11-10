// The app window's Content Security Policy (src-tauri/tauri.conf.json → app.security.csp) must not block the page.
// Tauri adds a sha256 hash of every inline <script> to script-src when it builds; style-src is left as written
// (dangerousDisableAssetCspModification), because CodeMirror and the Android plugin add <style> elements at run time,
// and a nonce there would switch 'unsafe-inline' off. This test serves the page with the same policy and drives
// the parts that load something: the bundled scripts, an image and a PDF from the vault (pdf.js and its worker
// from ./pdfjs/, as dist/ has them), the editor, the reading view.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const at = (p) => new URL("../" + p, import.meta.url);
const ORIGIN = "http://tauri.localhost";

/** The policy as Tauri sends it: the configured directives, with the inline scripts' hashes in script-src. */
function policy(html) {
  const csp = { ...JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8")).app.security.csp };
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[1].length)
    .map((m) => `'sha256-${createHash("sha256").update(m[1].replace(/\r\n?/g, "\n")).digest("base64")}'`);
  csp["script-src"] += " " + hashes.join(" ");
  return Object.entries(csp).map(([k, v]) => `${k} ${v}`).join("; ");
}

/** A one-page PDF with a line of text, with a correct cross-reference table. */
function pdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 20 40 Td (Hello PDF) Tj ET";
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

let browser;
after(async () => browser?.close());

test("the app's Content Security Policy blocks nothing the page needs, and does block an injected script", async () => {
  const html = readFileSync(at("web/supstack.html"), "utf8");
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ body: html, contentType: "text/html", headers: { "Content-Security-Policy": policy(html) } });
    const pdfjs = /^\/pdfjs\/([\w.]+\.mjs)$/.exec(path);
    if (pdfjs) return route.fulfill({ body: readFileSync(at("node_modules/pdfjs-dist/legacy/build/" + pdfjs[1])), contentType: "text/javascript" });
    return route.fulfill({ status: 404 });
  });
  // a 2×1 PNG (the native vault hands files over without a MIME type, which an SVG would need)
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKfQD/QxY5aEAAAAASUVORK5CYII=";
  await page.addInitScript(({ png, pdf }) => {
    window.__SN_EXPOSE__ = true;
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
    const b64 = (s) => (typeof s === "object" ? s.b64 : btoa(String.fromCharCode(...new TextEncoder().encode(s))));
    const files = {
      "cards/Home.md": "# Home\n\n[[Other]] #tag\n\n![[p.png]]\n\n![[doc.pdf]]\n\n```js\nconst a = 1;\n```\n",
      "cards/Other.md": "x",
      "attachments/p.png": { b64: png, length: 74 },
      "attachments/doc.pdf": pdf,
    };
    const vault = {
      exists: (a) => a.path === "" || a.path in files,
      list: () => Object.keys(files).map((path) => ({ path, mtime: 1, size: files[path].length })),
      read: (a) => ({ data: a.binary || typeof files[a.path] === "object" ? b64(files[a.path]) : files[a.path], mtime: 1, size: files[a.path].length }),
      write: (a) => { files[a.path] = a.text ?? atob(a.base64); return 1; },
      remove: (a) => { delete files[a.path]; return null; },
      list_dir: () => [], remove_dir: () => null, git_info: () => ({ isRepo: false }), git_save_settings: () => null,
    };
    window.__TAURI__ = { core: { invoke: async (cmd, a) => {
      const [plugin, c] = cmd.split("|");
      if (plugin !== "plugin:vault") return null;
      if (!vault[c]) throw new Error("no vault command " + c);
      return vault[c](a);
    } } };
    try { localStorage.clear(); localStorage.setItem("sn-ui", JSON.stringify({ lang: "en" })); localStorage.setItem("sn-native-last", JSON.stringify({ root: "/vault", name: "Vault" })); } catch { /* storage */ }
  }, { png, pdf: pdf() });

  await page.goto(ORIGIN + "/");
  await page.waitForSelector("#board .sn-card", { state: "attached" });
  // an inline script that is not in the page (what an injected <script> would be) does not run
  assert.equal(await page.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__injected = 1"; document.head.append(s); return window.__injected; }), undefined, "the policy is in force");
  await page.evaluate(() => { window.__csp.length = 0; });

  // the reading view: the image from a blob: URL, the PDF drawn by pdf.js from ./pdfjs/ with its worker
  await page.evaluate(() => { openEditor("cards/Home.md"); editor.mode = "read"; renderEditor(); });
  await page.waitForFunction(() => [...document.querySelectorAll(".sn-reading img")].some((i) => i.src.startsWith("blob:") && i.naturalWidth === 2));
  await page.waitForFunction(() => { const c = document.querySelector(".sn-reading canvas.sn-pdf-page"); return c && c.width > 0; });
  // the editor (CodeMirror adds its styles as it starts)
  await page.evaluate(() => { editor.mode = "edit"; renderEditor(); });
  await page.waitForSelector(".cm-editor");
  await page.evaluate(() => { editor.mode = "source"; renderEditor(); });
  await page.waitForSelector(".cm-editor .sn-editor-text.is-source");

  assert.deepEqual(await page.evaluate(() => window.__csp), [], "nothing was blocked");
  assert.deepEqual(errors, []);
});
