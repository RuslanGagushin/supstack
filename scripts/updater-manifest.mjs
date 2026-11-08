// Writes latest.json, the file the desktop apps' updater reads from the newest GitHub Release.
//   node scripts/updater-manifest.mjs <folder with the built files> <tag, e.g. v0.8.0> <owner/repo>
// It lists every signed update bundle in the folder: the NSIS installer for Windows and the
// .app.tar.gz for macOS (one universal build serves both Apple Silicon and Intel). Builds made
// without the signing key have no .sig files; then there is nothing to list and no file is written.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [dir, tag, repo] = process.argv.slice(2);
if (!dir || !tag || !repo) {
  console.error("usage: node scripts/updater-manifest.mjs <folder> <tag> <owner/repo>");
  process.exit(1);
}
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
const all = files(dir);
// GitHub stores release files under their base name, with spaces turned into dots
const url = (file) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(file).replace(/ /g, "."))}`;
const signed = (test) => {
  const file = all.find((f) => test.test(basename(f)) && all.includes(f + ".sig"));
  return file && { signature: readFileSync(file + ".sig", "utf8").trim(), url: url(file) };
};

const platforms = {};
const windows = signed(/-setup\.exe$/i);
if (windows) platforms["windows-x86_64"] = windows;
const mac = signed(/\.app\.tar\.gz$/i);
if (mac) platforms["darwin-aarch64"] = platforms["darwin-x86_64"] = mac;

if (!Object.keys(platforms).length) {
  console.warn("No signed update bundles found: latest.json not written, the apps won't see this release as an update.");
  process.exit(0);
}
const manifest = { version: tag.replace(/^v/, ""), notes: `https://github.com/${repo}/releases/tag/${tag}`, pub_date: new Date().toISOString(), platforms };
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json: ${manifest.version} for ${Object.keys(platforms).join(", ")}`);
