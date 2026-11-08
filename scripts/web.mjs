// Builds the page (scripts/page.mjs) and puts it into dist/index.html for Tauri, with pdf.js beside it in dist/pdfjs/.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage, PAGE } from "./page.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
buildPage();
mkdirSync(join(app, "dist"), { recursive: true });
copyFileSync(PAGE, join(app, "dist", "index.html"));
// pdf.js for PDF embeds on webviews without a PDF viewer of their own (Android); the page finds it at ./pdfjs/
const pdfjs = join(app, "node_modules", "pdfjs-dist", "legacy", "build");
if (existsSync(pdfjs)) {
  mkdirSync(join(app, "dist", "pdfjs"), { recursive: true });
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) copyFileSync(join(pdfjs, f), join(app, "dist", "pdfjs", f));
} else console.warn("pdfjs-dist is not installed: PDF embeds on Android will load pdf.js from the CDN.");
console.log("dist/index.html ready (from web/src)");
