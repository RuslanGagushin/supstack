// Bundles CodeMirror 6 (scripts/codemirror-entry.js) into web/src/vendor/codemirror.js, which sets window.CM;
// scripts/page.mjs inlines it into the page.
// Run after changing the entry or the @codemirror/@lezer versions: npm run codemirror
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(app, "web", "src", "vendor", "codemirror.js");
const out = await build({ entryPoints: [join(app, "scripts", "codemirror-entry.js")], bundle: true, minify: true, format: "iife", globalName: "CM", target: "es2020", write: false, legalComments: "none" });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const versions = ["@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language", "@lezer/markdown"].map((p) => `${p} ${JSON.parse(readFileSync(join(app, "node_modules", p, "package.json"))).version}`).join(", ");
writeFileSync(outFile, `/*! CodeMirror 6 (MIT) · ${versions} · bundled by scripts/codemirror.mjs */\n${js}`);
console.log(`CodeMirror: ${(js.length / 1024).toFixed(0)} KB into web/src/vendor/codemirror.js`);
