// Builds the single-file page web/supstack.html from its sources in web/src/.
// web/src/page.html is the page with <!-- include: path --> where each stylesheet and library goes, in order
// (a directive on a line of its own takes its line break with it), and <!-- bundle: js/main.js --> where the app goes:
// esbuild bundles the ES modules under web/src/js/ from that entry into one plain script, so the page still opens
// straight from disk. __APP_VERSION__ becomes package.json's version.
// npm test and npm run web build it first; on its own: npm run page
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(app, "web", "src");
export const PAGE = join(app, "web", "supstack.html");

/** The app's modules as one script (not minified, so the page stays readable); `files` are the modules it took in. */
export function bundle(entry) {
  const out = buildSync({
    entryPoints: [join(src, entry)], bundle: true, format: "iife", target: "es2022", write: false, metafile: true,
    charset: "utf8", legalComments: "none", logLevel: "silent",
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  return { js, files: Object.keys(out.metafile.inputs) };
}

export function buildPage() {
  const { version } = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const html = readFileSync(join(src, "page.html"), "utf8")
    .replace(/^<!-- include: (\S+) -->\n|<!-- include: (\S+) -->/gm, (_, line, inline) => readFileSync(join(src, line ?? inline), "utf8"))
    .replace(/<!-- bundle: (\S+) -->/g, (_, entry) => bundle(entry).js)
    .replace('"__APP_VERSION__"', () => JSON.stringify(version));
  // The page tests load this file in parallel while tests/web-build.test.mjs rebuilds it: leave an unchanged page
  // alone, and swap a new one in whole (write beside it, then rename), so no test ever reads a half-written page.
  if (existsSync(PAGE) && readFileSync(PAGE, "utf8") === html) return html;
  const tmp = `${PAGE}.${process.pid}.tmp`;
  writeFileSync(tmp, html);
  renameSync(tmp, PAGE);
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = buildPage();
  console.log(`web/supstack.html ready (${(html.length / 1024).toFixed(0)} KB)`);
}
