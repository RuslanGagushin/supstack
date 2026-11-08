// The page's modules come in three layers (see web/src/js/main.js); each may use only the layers before it:
//   core/      pure logic — imports only core/, touches neither the DOM nor the browser's storage, window or app state
//   services/  state, vault, files, sync — imports core/ and services/, never ui/, and does not touch the DOM
//   ui/        everything on screen — may import anything
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const JS = fileURLToPath(new URL("../web/src/js/", import.meta.url));
const modules = readdirSync(JS, { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => f.split(sep).join("/"));
const layer = (f) => (f.includes("/") ? f.split("/")[0] : "entry");
/** The source without comments and string contents, so only code is checked. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
  .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
const importsOf = (f) => [...readFileSync(join(JS, f), "utf8").matchAll(/^import\s[^;]*?from\s+"(\.[^"]+)";|^import\s+"(\.[^"]+)";/gm)]
  .map((m) => relative(JS, join(dirname(join(JS, f)), m[1] ?? m[2])).split(sep).join("/"));

const ALLOWED = { core: ["core"], services: ["core", "services"], ui: ["core", "services", "ui"] };

for (const [name, allowed] of Object.entries(ALLOWED)) {
  test(`${name}/ imports only from ${allowed.map((l) => l + "/").join(", ")}`, () => {
    const bad = modules.filter((f) => layer(f) === name).flatMap((f) => importsOf(f).filter((d) => !allowed.includes(layer(d))).map((d) => `${f} → ${d}`));
    assert.deepEqual(bad, []);
  });
}

test("core/ uses no DOM, browser storage, window or page libraries", () => {
  const banned = /\b(document|window|localStorage|sessionStorage|indexedDB|navigator|location|matchMedia|getComputedStyle|requestAnimationFrame|CM|marked|DOMPurify)\b/;
  const bad = modules.filter((f) => layer(f) === "core").flatMap((f) => code(readFileSync(join(JS, f), "utf8")).split("\n").map((l, i) => [l, i]).filter(([l]) => banned.test(l.replace(/\.\s*[\w$]+/g, ""))).map(([l, i]) => `${f}:${i + 1}: ${l.trim().slice(0, 80)}`));
  assert.deepEqual(bad, []);
});

test("services/ never touches the DOM", () => {
  const banned = /\b(document|getComputedStyle|requestAnimationFrame|matchMedia|CM|DOMPurify)\b/;
  const bad = modules.filter((f) => layer(f) === "services").flatMap((f) => code(readFileSync(join(JS, f), "utf8")).split("\n").map((l, i) => [l, i]).filter(([l]) => banned.test(l.replace(/\.\s*[\w$]+/g, ""))).map(([l, i]) => `${f}:${i + 1}: ${l.trim().slice(0, 80)}`));
  assert.deepEqual(bad, []);
});

test("every module is under core/, services/ or ui/ (main.js and expose.js aside)", () => {
  assert.deepEqual(modules.filter((f) => layer(f) === "entry").sort(), ["expose.js", "main.js"]);
});

test("js/expose.js lists every module that exports anything", () => {
  const listed = new Set([...readFileSync(join(JS, "expose.js"), "utf8").matchAll(/^import \* as \w+ from "\.\/([^"]+)";/gm)].map((m) => m[1]));
  const exporting = modules.filter((f) => layer(f) !== "entry" && /^export /m.test(readFileSync(join(JS, f), "utf8")));
  assert.deepEqual(exporting.filter((f) => !listed.has(f)), []);
});

// esbuild bundles a name that a module uses but never imports without complaint, and it only fails when that line
// runs (0.21.0 showed a white screen in the app: files.js used keyText without importing it, on a path the browser
// tests never take). So: a name another module exports must be imported, or declared, wherever it is used.
test("every name exported by one module is imported where another uses it", () => {
  const exported = new Map(); // name -> module
  for (const f of modules) for (const m of readFileSync(join(JS, f), "utf8").matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.set(m[1], f);
  const bad = [];
  for (const f of modules) {
    const src = readFileSync(join(JS, f), "utf8");
    const body = code(src.replace(/^import\s[^;]*;/gm, "")) // and without regex literals
      .replace(/(^|[=(,:;!&|?{}[]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuy]*/gm, '$1""');
    const known = new Set();
    for (const m of src.matchAll(/^import\s*\{([^}]*)\}/gm)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) known.add(n); }
    for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) known.add(m[1]);
    for (const m of body.matchAll(/\b(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
    for (const m of body.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]=]*)[}\]]/g)) for (const n of m[1].split(/[\s,:]+/)) if (n) known.add(n);
    for (const m of body.matchAll(/\(([^()]*)\)\s*=>|\bfunction\s*[\w$]*\s*\(([^()]*)\)|(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) for (const n of (m[1] ?? m[2] ?? m[3]).split(/[\s,{}[\]=.]+/)) if (n) known.add(n);
    for (const m of body.matchAll(/(?<![\w$.'"\\])([A-Za-z_$][\w$]*)\b(?!\s*:(?!:))/g)) {
      const n = m[1];
      if (exported.has(n) && exported.get(n) !== f && !known.has(n)) bad.push(`${f} uses ${n} (from ${exported.get(n)})`);
    }
  }
  assert.deepEqual([...new Set(bad)], []);
});

test("every CSS variable used without a fallback is defined, and no comment closes early", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const css = readdirSync(CSS).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(CSS, f), "utf8")).join("\n");
  const js = modules.map((f) => readFileSync(join(JS, f), "utf8")).join("\n");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  // a "*/" inside a comment's text ends it there, and the rest becomes a broken declaration that swallows the next one
  assert.doesNotMatch(bare, /\*\//, "a comment holds */ in its text");
  const defined = new Set([...bare.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const fromJs = new Set([...js.matchAll(/["'`](--[\w-]+)["'`]/g)].map((m) => m[1]));
  const missing = [...new Set([...bare.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]))].filter((v) => !defined.has(v) && !fromJs.has(v));
  assert.deepEqual(missing, []);
});
