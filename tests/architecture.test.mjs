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

test("shadows, layers, weights and motion come from base.css's variables", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const bad = [];
  for (const f of readdirSync(CSS).filter((f) => f.endsWith(".css"))) {
    const lines = readFileSync(join(CSS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n");
    lines.forEach((l, i) => {
      const at = `${f}:${i + 1}`;
      if (f !== "base.css" && /\b(?:rgba?|hsla?)\(/.test(l)) bad.push(`${at} colour function`);
      if (/z-index:\s*-?\d/.test(l)) bad.push(`${at} z-index`);
      if (/font-weight:\s*\d/.test(l)) bad.push(`${at} font-weight`);
      // spinners, the new card's flash and the reduced-motion override keep their own times
      if (/transition[\w-]*:[^;}]*\d+m?s\b/.test(l) && !/!important/.test(l)) bad.push(`${at} transition`);
      if (/animation:[^;}]*\d+m?s\b/.test(l) && !/sn-spin|wb-card-new/.test(l)) bad.push(`${at} animation`);
    });
  }
  assert.deepEqual(bad, []);
});

test("padding, margin and gap use the spacing scale; the measured offsets are listed here", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  // [a selector the rule starts with, the pixel value it keeps, why]
  const allowed = [
    [".markdown-rendered .org-entry .org-body", "18px", "a task's body starts under its text: box, gap and state letter"],
    ["input.fv-search", "30px", "room for the search icon"],
    ["input.sn-set-search", "30px", "room for the search icon"],
    [".tree-item-children", "11px", "the indent guide runs under the toggle's centre"],
    [".sn-reading:not(.sn-live) .sn-table-wrap", "17px", "room for the add-column button"],
    [".sn-table-host", "17px", "room for the add-column button"],
    [".sn-table-host", "15px", "room for the add-row button"],
    [".sn-row-thumb", "19px", "the thumbnail's top meets the row's title"],
    [".sn-page", "80px", "clears the phone's tab bar"],
    [".modal.mod-settings > .modal-title", "52px", "room for the close button"],
    [".modal-title", "44px", "room for the close button"],
    [":where(select)", "28px", "room for the chevron"],
  ];
  const bad = [];
  for (const f of readdirSync(CSS).filter((f) => f.endsWith(".css"))) {
    const bare = readFileSync(join(CSS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    for (const rule of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().replace(/\s+/g, " ");
      for (const d of rule[2].matchAll(/(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:\s*([^;]+)/g)) {
        for (const px of d[1].match(/(?<![\w.-])\d+(?:\.\d+)?px\b/g) ?? []) {
          if (px === "1px" || parseFloat(px) === 0) continue;
          if (allowed.some(([s, v]) => selector.startsWith(s) && v === px)) continue;
          bad.push(`${f}: ${selector.slice(0, 60)} { ${d[0].trim()} }`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("hex colours only in base.css's palette (masks aside) and, in the scripts, only for the code blocks' language badges", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const bad = [];
  for (const f of readdirSync(CSS).filter((f) => f.endsWith(".css") && f !== "base.css")) {
    const bare = readFileSync(join(CSS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    // a mask's #000 is how much shows through, not a colour
    for (const d of bare.matchAll(/([\w-]+)\s*:\s*([^;{}]*)/g)) if (!/mask/.test(d[1]) && /#[0-9a-f]{3,8}\b/i.test(d[2])) bad.push(`${f}: ${d[0].trim().slice(0, 70)}`);
  }
  for (const f of modules.filter((f) => f !== "ui/markdown.js")) {
    for (const m of code(readFileSync(join(JS, f), "utf8")).matchAll(/["'`]#[0-9a-f]{3,8}["'`]/gi)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("corners: the --r-* scale, a circle (50%), none (0) or a 1–2px hairline", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const ok = /^(var\(--r-(xs|s|m|l|pill)\)|50%|0|1px|2px)$/;
  const bad = [];
  for (const f of readdirSync(CSS).filter((f) => f.endsWith(".css"))) {
    const bare = readFileSync(join(CSS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const d of bare.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;{}]+)/g)) {
      if (!d[1].trim().split(/\s+/).every((v) => ok.test(v))) bad.push(`${f}: ${d[0].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("retired class names stay retired (docs/design-system.md has the ones that replaced them)", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const TESTS = fileURLToPath(new URL("./", import.meta.url));
  const retired = ["wb-btn", "mod-cta", "mod-warning", "is-cta", "fchip", "ag-chip", "sn-tag", "sn-tag-pill", "is-sel", "is-folded", "is-warning", "is-enabled", "is-on",
    "sn-editor-badge", "sn-info", "ag-week", "sb-round", "sb-account-note"]; // the last five: retired by the restyle (docs/restyle-specification.md)
  const sources = [
    ...readdirSync(CSS).filter((f) => f.endsWith(".css")).map((f) => [f, readFileSync(join(CSS, f), "utf8")]),
    ...modules.map((f) => [f, readFileSync(join(JS, f), "utf8")]),
    ...readdirSync(TESTS).filter((f) => f.endsWith(".mjs") && f !== "architecture.test.mjs").map((f) => [f, readFileSync(join(TESTS, f), "utf8")]),
  ];
  const bad = [];
  for (const [f, src] of sources) for (const c of retired) if (new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(src)) bad.push(`${f}: ${c}`);
  assert.deepEqual(bad, []);
});

test("one layer of styles: no body.sn-app prefix; !important only on the hide utilities and for reduced motion", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const hide = [".markdown-rendered .org-hidden", ".sn-board .sn-tools > .sn-wide-only", ".sn-hide-narrow"];
  const bad = [];
  for (const f of readdirSync(CSS).filter((f) => f.endsWith(".css"))) {
    const bare = readFileSync(join(CSS, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    if (/body\.sn-app/.test(bare)) bad.push(`${f}: body.sn-app`);
    for (const rule of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (!rule[2].includes("!important")) continue;
      const selector = rule[1].trim().replace(/\s+/g, " ");
      const motion = selector === "*, *::before, *::after";
      const utility = hide.includes(selector) && /^\s*display:\s*none\s*!important;?\s*$/.test(rule[2]);
      if (!motion && !utility) bad.push(`${f}: ${selector} { ${rule[2].trim().slice(0, 60)} }`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every CSS variable the stylesheets define is used, by a stylesheet or by the scripts", () => {
  const CSS = fileURLToPath(new URL("../web/src/css/", import.meta.url));
  const bare = readdirSync(CSS).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(CSS, f), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");
  const js = modules.map((f) => readFileSync(join(JS, f), "utf8")).join("\n");
  const defined = new Set([...bare.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...(bare + js).matchAll(/var\(\s*(--[\w-]+)/g), ...js.matchAll(/["'`](--[\w-]+)["'`]/g)].map((m) => m[1]));
  assert.deepEqual([...defined].filter((v) => !used.has(v)).sort(), []);
});
