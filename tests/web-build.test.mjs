// scripts/page.mjs builds the page from web/src; scripts/web.mjs puts it into dist/ for Tauri, with pdf.js beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "../scripts/page.mjs";

const app = fileURLToPath(new URL("..", import.meta.url));
const at = (p) => new URL("../" + p, import.meta.url);

test("dist/index.html is the page, pdf.js is next to it", () => {
  const out = execFileSync(process.execPath, ["scripts/web.mjs"], { cwd: app, encoding: "utf8" });
  assert.match(out, /dist\/index\.html ready/);
  assert.ok(readFileSync(at("dist/index.html")).equals(readFileSync(at("web/supstack.html"))));
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) assert.ok(existsSync(at("dist/pdfjs/" + f)), f);
});

test("web/src/page.html includes every stylesheet and library once, the bundle takes in every module, no directives are left", () => {
  const files = readdirSync(at("web/src"), { recursive: true }).map((f) => f.split(sep).join("/"));
  const html = readFileSync(at("web/src/page.html"), "utf8");
  const included = [...html.matchAll(/<!-- include: (\S+) -->/g)].map((m) => m[1]);
  assert.deepEqual([...included].sort(), files.filter((f) => /\.(css|js)$/.test(f) && !f.startsWith("js/")).sort());
  assert.deepEqual([...html.matchAll(/<!-- bundle: (\S+) -->/g)].map((m) => m[1]), ["js/main.js"]);
  const bundled = bundle("js/main.js").files.map((f) => f.replace(/^web\/src\//, "")).sort();
  assert.deepEqual(bundled, files.filter((f) => f.startsWith("js/") && f.endsWith(".js")).sort(), "every module under web/src/js is reachable from main.js");
  assert.doesNotMatch(readFileSync(at("web/supstack.html"), "utf8"), /<!-- (include|bundle):|__APP_VERSION__/);
});

test("web/src/vendor has marked and DOMPurify at the versions package.json pins (npm run vendor copies them)", () => {
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
  for (const [name, file, header] of [["marked", "marked.js", /marked v(\S+) - a markdown parser/], ["dompurify", "dompurify.js", /DOMPurify (\S+) \|/]]) {
    const pinned = pkg.devDependencies[name];
    assert.match(pinned, /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version`);
    assert.equal(header.exec(readFileSync(at("web/src/vendor/" + file), "utf8"))?.[1], pinned, `web/src/vendor/${file} is ${name} ${pinned}`);
    assert.equal(JSON.parse(readFileSync(at(`node_modules/${name}/package.json`), "utf8")).version, pinned);
  }
});

test("the page loads pdf.js from ./pdfjs/ before the CDN, at the installed version", () => {
  const page = readFileSync(at("web/src/js/ui/markdown.js"), "utf8");
  const version = JSON.parse(readFileSync(at("node_modules/pdfjs-dist/package.json"), "utf8")).version;
  assert.match(page, new RegExp(`const PDFJS_VERSION = "${version.replace(/\./g, "\\.")}"`), "PDFJS_VERSION matches package.json's pdfjs-dist");
  assert.match(page, /\.\/pdfjs\//);
});

test("the page's APP_VERSION (filled in from package.json) and the app's version match package.json", () => {
  const version = JSON.parse(readFileSync(at("package.json"), "utf8")).version;
  assert.match(readFileSync(at("web/supstack.html"), "utf8"), new RegExp(`(?:const|var) APP_VERSION = "${version.replace(/\./g, "\\.")}"`));
  assert.equal(JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8")).version, version);
});

test("the updater checks this repository's latest release and has a signing key", () => {
  const conf = JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8"));
  assert.match(conf.plugins.updater.endpoints[0], /^https:\/\/github\.com\/RuslanGagushin\/supstack\/releases\/latest\/download\/latest\.json$/);
  assert.match(Buffer.from(conf.plugins.updater.pubkey, "base64").toString(), /minisign public key/);
});

test("scripts/updater-manifest.mjs lists the signed Windows and macOS bundles in latest.json", () => {
  const out = mkdtempSync(join(tmpdir(), "sn-release-"));
  const put = (p, text) => { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), text); };
  put("Supstack-Windows/nsis/Supstack_0.8.0_x64-setup.exe", "exe");
  put("Supstack-Windows/nsis/Supstack_0.8.0_x64-setup.exe.sig", "WINSIG\n");
  put("Supstack-Windows/msi/Supstack_0.8.0_x64_en-US.msi", "msi");
  put("Supstack-macOS/macos/Supstack.app.tar.gz", "tgz");
  put("Supstack-macOS/macos/Supstack.app.tar.gz.sig", "MACSIG");
  put("Supstack-Android/app-universal-release.apk", "apk");
  execFileSync(process.execPath, ["scripts/updater-manifest.mjs", out, "v0.8.0", "you/repo"], { cwd: app });
  const m = JSON.parse(readFileSync(join(out, "latest.json"), "utf8"));
  assert.equal(m.version, "0.8.0");
  assert.deepEqual(m.platforms["windows-x86_64"], { signature: "WINSIG", url: "https://github.com/you/repo/releases/download/v0.8.0/Supstack_0.8.0_x64-setup.exe" });
  assert.deepEqual(m.platforms["darwin-aarch64"], { signature: "MACSIG", url: "https://github.com/you/repo/releases/download/v0.8.0/Supstack.app.tar.gz" });
  assert.deepEqual(m.platforms["darwin-x86_64"], m.platforms["darwin-aarch64"]);
  // unsigned builds: nothing to offer, no manifest
  const bare = mkdtempSync(join(tmpdir(), "sn-release-"));
  writeFileSync(join(bare, "Supstack_0.8.0_x64-setup.exe"), "exe");
  execFileSync(process.execPath, ["scripts/updater-manifest.mjs", bare, "v0.8.0", "you/repo"], { cwd: app, stdio: "pipe" });
  assert.ok(!existsSync(join(bare, "latest.json")));
});
