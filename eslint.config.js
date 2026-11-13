// ESLint for the app's own code (spec QA-1): the page's modules, the build scripts and the tests. `npm run lint`.
// The recommended rules, with two exceptions below. vendor/ holds bundled libraries and is not ours to lint.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["web/src/vendor/**", "web/supstack.html", "dist/**", "src-tauri/**", "tauri-plugin-vault/**", "node_modules/**"] },
  js.configs.recommended,
  {
    rules: {
      // regexes here escape "/" and "[" where they need not; the escapes are harmless, and rewriting working regexes is not
      "no-useless-escape": "off",
    },
  },
  {
    files: ["web/src/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "module",
      // the libraries in web/src/vendor/, which the page loads as globals before the app
      globals: { ...globals.browser, CM: "readonly", marked: "readonly", DOMPurify: "readonly", jsyaml: "readonly" },
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
  },
  {
    // most of a test is code that page.evaluate runs in the page, against the app's exports made global
    // (js/expose.js): to ESLint those names look undefined
    files: ["tests/**/*.mjs", "scripts/screenshots.mjs"],
    rules: { "no-undef": "off" },
  },
  {
    // the tests match YAML and Markdown indentation, where "  - " reads better than " {2}- "
    files: ["tests/**/*.mjs"],
    rules: { "no-regex-spaces": "off" },
  },
];
