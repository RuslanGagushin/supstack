// Copies marked and DOMPurify from node_modules into web/src/vendor/, where web/src/page.html includes them.
// They are devDependencies only so that their versions are pinned in package.json and npm audit sees them;
// after updating one: npm run vendor (tests/web-build.test.mjs checks the copies match the installed versions).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VENDORED = [
  { pkg: "marked", file: "lib/marked.umd.js", to: "marked.js" },
  { pkg: "dompurify", file: "dist/purify.min.js", to: "dompurify.js" },
];

for (const { pkg, file, to } of VENDORED) {
  const js = readFileSync(join(app, "node_modules", pkg, file), "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
  writeFileSync(join(app, "web", "src", "vendor", to), js);
  const { version } = JSON.parse(readFileSync(join(app, "node_modules", pkg, "package.json"), "utf8"));
  console.log(`${pkg} ${version} → web/src/vendor/${to}`);
}
