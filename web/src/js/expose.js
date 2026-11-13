// The page tests (tests/harness.mjs) drive the page through its modules' exports: with window.__SN_EXPOSE__ set
// before the page loads, each export becomes a global that reads the live binding. One line per module that exports
// anything (tests/architecture.test.mjs checks the list is complete).
import * as m0 from "./core/strings.js";
import * as m1 from "./core/i18n.js";
import * as m2 from "./core/util.js";
import * as m3 from "./core/dates.js";
import * as m4 from "./core/frontmatter.js";
import * as m5 from "./core/graph.js";
import * as m6 from "./core/board-model.js";
import * as m7 from "./core/org.js";
import * as m8 from "./core/tables.js";
import * as m50 from "./core/embed.js";
import * as m51 from "./core/search.js";
import * as m52 from "./core/ics.js";
import * as m9 from "./services/storage.js";
import * as m10 from "./services/events.js";
import * as m11 from "./services/fs.js";
import * as m12 from "./services/native.js";
import * as m13 from "./services/state.js";
import * as m14 from "./services/folders.js";
import * as m15 from "./services/vault.js";
import * as m16 from "./services/attachments.js";
import * as m17 from "./services/save.js";
import * as m18 from "./services/daily-notes.js";
import * as m19 from "./services/tasks.js";
import * as m20 from "./services/sync.js";
import * as m21 from "./services/updates.js";
import * as m49 from "./services/index-cache.js";
import * as m22 from "./ui/dom.js";
import * as m23 from "./ui/ui.js";
import * as m24 from "./ui/markdown.js";
import * as m25 from "./ui/actions.js";
import * as m27 from "./ui/cards.js";
import * as m28 from "./ui/board.js";
import * as m29 from "./ui/dnd.js";
import * as m30 from "./ui/tree.js";
import * as m31 from "./ui/editor.js";
import * as m32 from "./ui/live-preview.js";
import * as m33 from "./ui/table-editor.js";
import * as m34 from "./ui/editor-toolbar.js";
import * as m35 from "./ui/format-bar.js";
import * as m36 from "./ui/shell.js";
import * as m37 from "./ui/welcome.js";
import * as m38 from "./ui/sync-panel.js";
import * as m39 from "./ui/completion.js";
import * as m40 from "./ui/org-commands.js";
import * as m41 from "./ui/org-editing.js";
import * as m42 from "./ui/agenda.js";
import * as m43 from "./ui/files.js";
import * as m44 from "./ui/native-shell.js";
import * as m45 from "./ui/about.js";
import * as m46 from "./ui/boot.js";
import * as m47 from "./ui/task-icons.js";
import * as m48 from "./ui/app-icon.js";

export function exposeGlobals() {
  for (const ns of [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m27, m28, m29, m30, m31, m32, m33, m34, m35, m36, m37, m38, m39, m40, m41, m42, m43, m44, m45, m46, m47, m48, m49, m50, m51, m52]) {
    for (const k of Object.keys(ns)) {
      try { Object.defineProperty(globalThis, k, { get: () => ns[k], configurable: true }); } catch { /* a browser global of that name (top, name…) stays */ }
    }
  }
}
