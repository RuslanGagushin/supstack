// A large made-up vault for measuring the app (spec PERF-1): notebooks nested up to four levels, notes in one or two
// notebooks, tags, wikilinks, tasks with SCHEDULED / DEADLINE dates and daily notes. The same count and seed give the same vault.
//
//   node scripts/big-vault.mjs 10000 ../big-vault     writes the notes into that folder (it must be empty or missing)
//
// The page tests import bigVault() and open the result in memory (tests/perf.test.mjs).
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORDS = ("river stone bridge garden market letter window harbour forest lantern engine paper ladder orchard signal " +
  "harvest compass meadow archive tower kettle valley thread mirror canal pocket summit ribbon anchor whistle granite " +
  "harbor velvet beacon saddle quarry timber cobalt sparrow marble cinder fable lattice amber prism glacier willow").split(" ");
const TAGS = ["work", "home", "reading", "idea", "travel", "health", "finance", "people", "project", "someday", "review", "draft"];
const STATES = [" ", " ", " ", "/", "<", "x", "x", "-", ">"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Mulberry32: a small seeded generator, so a vault can be made again exactly. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The vault as { path: { text, mtime } }.
 * - count: how many notes (notebooks, notes and daily notes together)
 * - now: the clock the dates are made from (ms)
 */
export function bigVault(count = 10000, { seed = 1, now = Date.UTC(2026, 10, 12, 9) } = {}) {
  const rnd = random(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const title = (i) => { const w = words(2); return w[0].toUpperCase() + w.slice(1) + " " + i; };
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const stamp = (offsetDays, time = "") => { const ms = now + offsetDays * 86400000; return `${ymd(ms)} ${DAYS[new Date(ms).getUTCDay()]}${time}`; };

  const out = {};
  const daily = Math.round(count * 0.05);
  const notebooks = Math.max(4, Math.round(count * 0.05));
  const notes = count - daily - notebooks;

  // notebooks: the first ones at the top level, each later one inside an earlier one, so the tree is up to four deep
  const books = [];
  for (let i = 0; i < notebooks; i++) {
    const name = "Notebook " + title(i);
    const parentPool = books.filter((b) => b.depth < 3);
    const parent = i < 4 || !parentPool.length ? null : pick(parentPool);
    books.push({ name, depth: parent ? parent.depth + 1 : 0 });
    const fm = parent ? `parents:\n  - "[[${parent.name}]]"\n` : `order: ${i}\n`;
    out[`cards/${name}.md`] = { text: `---\n${fm}icon: folder\n---\n${cap(words(int(8, 20)))}.\n`, mtime: now - int(1, 400) * 86400000 };
  }

  const names = [];
  for (let i = 0; i < notes; i++) names.push(title(i));
  for (let i = 0; i < notes; i++) {
    const parents = [pick(books).name];
    if (rnd() < 0.15) parents.push(pick(books).name);
    const tags = rnd() < 0.6 ? [...new Set(Array.from({ length: int(1, 3) }, () => pick(TAGS)))] : [];
    let fm = `parents:\n${[...new Set(parents)].map((p) => `  - "[[${p}]]"`).join("\n")}\n`;
    if (tags.length) fm += `tags: [${tags.join(", ")}]\n`;
    const body = [];
    for (let p = int(1, 4); p > 0; p--) {
      let para = cap(words(int(15, 60))) + ".";
      if (rnd() < 0.4) para += ` See [[${pick(names)}]].`;
      if (rnd() < 0.1) para += ` #${pick(TAGS)}`;
      body.push(para);
    }
    if (rnd() < 0.35) {
      body.push("## Tasks");
      const lines = [];
      for (let t = int(1, 6); t > 0; t--) {
        const state = pick(STATES);
        const pri = rnd() < 0.2 ? `[#${pick(["A", "B", "C"])}] ` : "";
        lines.push(`- [${state}] ${pri}${cap(words(int(2, 6)))}`);
        const r = rnd();
        if (state === "x" && r < 0.5) lines.push(`  CLOSED: [${stamp(-int(0, 30), " 18:00")}]`);
        else if (r < 0.25) lines.push(`  SCHEDULED: <${stamp(int(-10, 30), rnd() < 0.3 ? " 10:00" : "")}>`);
        else if (r < 0.4) lines.push(`  DEADLINE: <${stamp(int(-5, 40))}>`);
      }
      body.push(lines.join("\n"));
    }
    out[`cards/${names[i]}.md`] = { text: `---\n${fm}---\n# ${names[i]}\n\n${body.join("\n\n")}\n`, mtime: now - int(0, 365) * 86400000 - int(0, 86399999) };
  }

  for (let i = 0; i < daily; i++) {
    const ms = now - i * 86400000;
    out[`daily notes/${ymd(ms)}.md`] = { text: `- [${pick(STATES)}] ${cap(words(int(2, 5)))}\n\n${cap(words(int(10, 40)))}.\n`, mtime: ms };
  }
  return out;
}
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

// run as a script: write the vault into a folder
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [countArg, dirArg] = process.argv.slice(2);
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 10 || !dirArg) {
    console.error("usage: node scripts/big-vault.mjs <count> <folder>");
    process.exit(1);
  }
  const dir = resolve(dirArg);
  if (existsSync(dir) && readdirSync(dir).length) { console.error(`${dir} is not empty`); process.exit(1); }
  const vault = bigVault(count);
  for (const [path, { text, mtime }] of Object.entries(vault)) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, mtime / 1000, mtime / 1000);
  }
  console.log(`${Object.keys(vault).length} notes in ${dir}`);
}
