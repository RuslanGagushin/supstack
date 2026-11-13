/* =========================================================
   Welcome, opening vaults, demo
   ========================================================= */
import { APP_ICON } from "./app-icon.js";
import { nt, t } from "../core/i18n.js";
import { HandleFS, idb, MemoryFS } from "../services/fs.js";
import { IS_ANDROID, IS_NATIVE, lastNative } from "../services/native.js";
import { saveUI, UI, vault } from "../services/state.js";
import { OLD_SETTINGS_PATH, SETTINGS_PATH } from "../services/vault.js";
import { $, h, ic, iconBtn } from "./dom.js";
import { Menu, notice } from "./ui.js";
import { applyLanguage, applyTheme, loadVault } from "./shell.js";
import { nativePick, nativeReopen } from "./native-shell.js";

export const hasFsApi = typeof window.showDirectoryPicker === "function";
export async function pickVault() {
  if (IS_NATIVE) return nativePick();
  if (!hasFsApi) { $("#folder-input").click(); return; }
  try {
    const handle = await window.showDirectoryPicker({ id: "supstack-vault", mode: "readwrite" });
    await idb.set("lastVault", handle);
    await loadVault(new HandleFS(handle));
  } catch (e) { if (e.name !== "AbortError") notice(String(e.message || e)); }
}
async function reopenVault(handle) {
  try {
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm === "granted") await loadVault(new HandleFS(handle));
  } catch (e) { notice(String(e.message || e)); }
}
export async function loadCopy(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const rootName = (files[0].webkitRelativePath || files[0].name).split("/")[0];
  const fs = new MemoryFS(rootName, "copy");
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/");
    if (!rel) continue;
    if (/\.md$/i.test(rel)) fs.add(rel, await f.text(), f.lastModified);
    else if (rel === SETTINGS_PATH || rel === OLD_SETTINGS_PATH) fs.add(rel, await f.text(), f.lastModified); // the settings, also where they were kept before
    else fs.add(rel, f, f.lastModified);
  }
  await loadVault(fs);
}
export function demoVault() {
  const fs = new MemoryFS("Demo vault", "demo");
  const now = Date.now();
  const d = (days) => now - days * 86400000;
  const note = (name, fm, body, days = 3) => fs.add(`cards/${name}.md`, (fm ? `---\n${fm.trim()}\n---\n` : "") + body.trim() + "\n", d(days));
  note("History", `icon: landmark\ncolor: orange\norder: 1`, `Everything about the past.\n\nSee also [[Knowledge]].`, 20);
  note("Roman Empire", `parents:\n  - "[[History]]"\nicon: crown\nchild_order:\n  - "[[Colosseum]]"\n  - "[[Aqueducts]]"`, `The state that existed from 27 BC.\n\nSee also [[Colosseum]].`, 12);
  note("Architecture", `icon: building-2\ncolor: blue\norder: 2`, `Buildings, bridges and the people who built them.`, 18);
  note("Architectural Marvels", `parents:\n  - "[[Architecture]]"\nicon: sparkles`, `The most impressive structures ever made.`, 9);
  note("Aqueducts", `parents:\n  - "[[Roman Empire]]"\n  - "[[Architectural Marvels]]"\ncolor: green\nicon: waves\ntags: [engineering]`, `This note sits in **two notebooks** — it shows up in both, together with the notes inside it.\n\n- gravity-fed channels\n- arched bridges\n\n> [!tip] Try it\n> Drag this note onto a notebook to move it there. Hold **Ctrl** or **Alt** to add it to that notebook as well.`, 1);
  note("Pont du Gard", `parents:\n  - "[[Aqueducts]]"\nicon: milestone`, `A Roman aqueduct bridge in southern France, built in the 1st century AD.\n\n| Fact | Value |\n|---|---|\n| Height | 48.8 m |\n| Tiers | 3 |`, 6);
  note("Colosseum", `parents:\n  - "[[Roman Empire]]"\n  - "[[Architectural Marvels]]"\nicon: castle\ncolor: yellow`, `An amphitheatre for 50,000 spectators.\n\n- [x] Read about the hypogeum\n- [ ] Visit at sunrise\n\n#travel`, 0.02);
  note("Knowledge", `icon: book-open\ncolor: purple\norder: 3`, `How to learn and keep what you learn.`, 30);
  note("Terms", `parents:\n  - "[[Knowledge]]"\nicon: book-a`, `Short definitions worth remembering.`, 25);
  note("Choice paralysis", `parents:\n  - "[[Terms]]"\ncolor: cyan\nicon: brain\ntags:\n  - productivity\n  - definition`, `When there are too many options, choosing gets harder, not easier. Instead of a decision you get endless comparison — and no progress.`, 4);
  note("Manual mode", `parents:\n  - "[[Terms]]"\nicon: wrench\ntags: [definition]`, `The simplest way to test a service is to do everything by hand behind the scenes for a while.\n\nIf people pay for the manual version, automation will surely pay off. If they don't, you've saved months of development.`, 2);
  note("Back-of-napkin math", `parents:\n  - "[[Terms]]"\nicon: calculator\ntags: [definition]`, `A rough estimate that's good enough to decide whether an idea is worth a closer look.\n\n==Order of magnitude beats precision.==`, 7);
  const day = (n) => { const d0 = new Date(now + n * 86400000); return `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`; };
  const dts = (n, extra = "") => { const d0 = new Date(now + n * 86400000); return `${day(n)} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d0.getDay()]}${extra}`; };
  note("This week", `icon: calendar-check\ncolor: green\norder: 0\ncategory: Week`, `Tasks in plain Markdown — open **Agenda** in the sidebar (Ctrl+Shift+K). Click a box to tick it, right-click it for every state.\n\n## Trip\n\n- [/] [#A] Book the Pont du Gard tour :travel:\n  DEADLINE: <${dts(1)}> SCHEDULED: <${dts(-1)}>\n  Call the visitor centre first.\n- [ ] Finish reading about [[Aqueducts]]\n  SCHEDULED: <${dts(0, " 10:00")}>\n  - [x] gravity-fed channels\n  - [ ] arched bridges\n  - [ ] siphons\n\n## Routines\n\n- [ ] Weekly review :review:\n  SCHEDULED: <${dts(3)} +1w>\n- [<] [#C] Order the history book\n- [>] Plan the Rome trip (moved to next month)\n- [-] Renew the old museum pass\n- [x] Set up this vault\n  CLOSED: [${dts(-2, " 18:20")}]\n\n## Calendar\n\n- Lunch with Marta <${dts(0, " 13:00-14:00")}>\n- Museum night <${dts(2, " 19:30")}> #travel\n`, 0.01);
  note("Cycle A", `parents:\n  - "[[Cycle B]]"\ncolor: red\nicon: refresh-cw`, `Notebooks A and B are inside each other. Their lists and a search must not hang.`, 10);
  note("Cycle B", `parents:\n  - "[[Cycle A]]"\nicon: refresh-ccw`, `The other half of the cycle.`, 10);
  note("Orphan", `parents:\n  - "[[A note that doesn't exist]]"\ncolor: grey`, `Its parent is missing — the chip is shown dashed.`, 15);
  note("Draft thoughts", `order: 4\nicon: pencil-line`, `Ideas that don't belong anywhere yet.\n\n1. A notebook per project\n2. Weekly review note\n\n\`\`\`js\n// code is rendered too\nconst cards = vault.filter(isCard);\n\`\`\``, 0.3);
  fs.add("cards/Templates/Book.md", `---\nicon: book\ncolor: purple\ntags: [book]\n---\n**Author:** \n**Read:** {{date}}\n\n## Notes\n`, d(40));
  return fs;
}
export async function showWelcome() {
  applyLanguage();
  $("#app").replaceChildren();
  $("#welcome")?.remove();
  const last = IS_NATIVE ? null : hasFsApi ? await idb.get("lastVault") : null;
  if (vault.fs) return; // a vault opened while this waited
  const card = h("div", { cls: "sn-welcome-card" },
    h("img", { cls: "sn-welcome-logo", src: APP_ICON, alt: "", width: "72", height: "72" }),
    h("h1", { cls: "sn-welcome-title", text: "Supstack" }), h("p", { cls: "sn-welcome-sub", text: t("welcomeSub") }));
  const actions = h("div", { cls: "sn-welcome-actions" });
  if (IS_NATIVE) {
    const ln = lastNative();
    if (ln) actions.append(h("button", { cls: "sn-btn is-primary", onClick: () => nativeReopen(ln) }, ic("", "history"), t("reopen", { name: ln.name })));
    actions.append(h("button", { cls: "sn-btn" + (ln ? "" : " is-primary"), onClick: () => nativePick() }, ic("", "folder-open"), nt("openFolder")));
  } else if (hasFsApi) {
    actions.append(h("button", { cls: "sn-btn is-primary", onClick: () => pickVault() }, ic("", "folder-open"), t("openVault")));
    if (last) actions.append(h("button", { cls: "sn-btn", onClick: () => reopenVault(last) }, ic("", "history"), t("reopen", { name: last.name })));
  } else {
    actions.append(h("button", { cls: "sn-btn is-primary", onClick: () => $("#folder-input").click() }, ic("", "folder-open"), t("loadCopy")));
  }
  actions.append(h("button", { cls: "sn-btn", onClick: () => loadVault(demoVault()) }, ic("", "flask-conical"), t("demo")));
  card.append(actions, h("p", { cls: "sn-welcome-note", text: IS_NATIVE ? nt(IS_ANDROID ? "appNoteAndroid" : "appNote") : hasFsApi ? t("browserNote") : t("noFsApi") }));
  const corner = h("div", { cls: "sn-welcome-corner" },
    iconBtn("languages", "Language", (e) => { const m = new Menu(); for (const [v, l] of [["auto", "Auto"], ["en", "English"], ["ru", "Русский"]]) m.add(l, null, () => { UI.lang = v; saveUI(); showWelcome(); }, { checked: UI.lang === v }); m.showBelow(e.currentTarget); }),
    iconBtn("sun-moon", "Theme", () => { const dark = document.body.classList.contains("theme-dark"); UI.theme = dark ? "light" : "dark"; saveUI(); applyTheme(); }));
  document.body.append(h("div", { cls: "sn-welcome", id: "welcome" }, corner, card));
}

