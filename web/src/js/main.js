/* Supstack Standalone — a folder of Markdown notes as notebooks, in one HTML file.
   The hierarchy lives in each note's frontmatter (parents / child_order / order / color / icon /
   child_template); the page shows it as a board and a tree, with drag & drop, multi-select and undo.

   Entry point: scripts/page.mjs bundles it (esbuild) into the page. The modules come in three layers,
   each using only the ones before it (tests/architecture.test.mjs checks this):
     core/      pure logic: parsing, the hierarchy graph, the board model, Org TODOs, tables, texts — no DOM, no app state
     services/  app state, the vault, saving and undo, files, Git sync, updates — no DOM; they tell the page through services/events.js
     ui/        everything on screen: rendering, menus, keys, the editor */
import "./core/strings.js";
import "./core/i18n.js";
import "./core/util.js";
import "./core/dates.js";
import "./core/frontmatter.js";
import "./core/graph.js";
import "./core/board-model.js";
import "./core/org.js";
import "./core/tables.js";
import "./core/embed.js";
import "./core/search.js";
import "./core/ics.js";
import "./services/storage.js";
import "./services/events.js";
import "./services/fs.js";
import "./services/native.js";
import "./services/state.js";
import "./services/folders.js";
import "./services/vault.js";
import "./services/attachments.js";
import "./services/save.js";
import "./services/daily-notes.js";
import "./services/tasks.js";
import "./services/sync.js";
import "./services/updates.js";
import "./services/index-cache.js";
import "./ui/dom.js";
import "./ui/ui.js";
import "./ui/markdown.js";
import "./ui/actions.js";
import "./ui/cards.js";
import "./ui/board.js";
import "./ui/dnd.js";
import "./ui/tree.js";
import "./ui/editor.js";
import "./ui/live-preview.js";
import "./ui/table-editor.js";
import "./ui/editor-toolbar.js";
import "./ui/format-bar.js";
import "./ui/keyboard.js";
import "./ui/shell.js";
import "./ui/welcome.js";
import "./ui/sync-panel.js";
import "./ui/completion.js";
import "./ui/org-commands.js";
import "./ui/org-editing.js";
import "./ui/agenda.js";
import "./ui/files.js";
import "./ui/native-shell.js";
import "./ui/about.js";
import { boot } from "./ui/boot.js";
import { exposeGlobals } from "./expose.js";

if (window.__SN_EXPOSE__) exposeGlobals();
boot();
