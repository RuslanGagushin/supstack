/* =========================================================
   Tables, edited in place: Tab and Enter move between cells, the source stays aligned in columns,
   and a menu (right click, the toolbar's table button, the + buttons on a rendered table) adds, moves, sorts, aligns and deletes rows and columns.
   A parsed table is { rows: [[cell text]], align: ["" | "left" | "center" | "right"] }; rows[0] is the header.
   This module is the text side: finding, parsing and formatting tables, and the row / column operations.
   ========================================================= */
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** [start, end) of each cell's trimmed text in a row; pipes escaped as \| stay in their cell. */
export function tableSpans(line) {
  const spans = [];
  let start = 0;
  for (let i = 0; i <= line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (i >= line.length || line[i] === "|") { spans.push([start, Math.min(i, line.length)]); start = i + 1; }
  }
  if (/^\s*\|/.test(line)) spans.shift();
  if (spans.length > 1 && !line.slice(spans.at(-1)[0]).trim()) spans.pop();
  return spans.map(([a, b]) => { while (a < b && /\s/.test(line[a])) a++; while (b > a && /\s/.test(line[b - 1])) b--; return [a, b]; });
}
export const tableCells = (line) => tableSpans(line).map(([a, b]) => line.slice(a, b));
/** Tables in Markdown text, outside code blocks and quotes: [{ from, to, lines }], `to` at the end of the last row. */
export function findTables(text) {
  const out = [], lines = text.split("\n");
  let pos = 0, fence = null;
  const starts = lines.map((l) => { const p = pos; pos += l.length + 1; return p; });
  const row = (l) => l?.includes("|") && l.trim() && !/^\s*>/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (f) { fence = !fence ? f[1] : lines[i].trim().startsWith(fence) ? null : fence; continue; }
    if (fence || !row(lines[i]) || !row(lines[i + 1]) || !TABLE_SEP_RE.test(lines[i + 1])) continue;
    let j = i + 2;
    while (j < lines.length && row(lines[j])) j++;
    out.push({ from: starts[i], to: starts[j - 1] + lines[j - 1].length, lines: lines.slice(i, j) });
    i = j - 1;
  }
  return out;
}
export function parseTable(lines) {
  const sep = tableCells(lines[1]);
  const rows = [lines[0], ...lines.slice(2)].map(tableCells);
  const n = Math.max(sep.length, ...rows.map((r) => r.length));
  const align = Array.from({ length: n }, (_, i) => { const c = sep[i] || ""; return c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""; });
  return { rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? "")), align };
}
/** Columns line up as on screen: wide (CJK) characters and emoji take two. */
const strWidth = (s) => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}]/u.test(ch) ? 2 : 1), 0);
/** The table as aligned Markdown; cell(r, c) is the [start, end) of a cell's text in it. */
export function formatTable(t) {
  const w = t.align.map((a, i) => Math.max(3, ...t.rows.map((r) => strWidth(r[i]))));
  const pos = [];
  let text = "";
  t.rows.forEach((cells, r) => {
    if (r) text += "\n";
    pos[r] = [];
    text += "|";
    cells.forEach((c, i) => { text += " "; pos[r][i] = [text.length, text.length + c.length]; text += c + " ".repeat(w[i] - strWidth(c)) + " |"; });
    if (!r) text += "\n|" + t.align.map((a, i) => {
      const l = a === "left" || a === "center", rt = a === "right" || a === "center";
      return " " + (l ? ":" : "") + "-".repeat(w[i] - Number(l) - Number(rt)) + (rt ? ":" : "") + " |";
    }).join("");
  });
  return { text, cell: (r, c) => pos[Math.max(0, Math.min(r, pos.length - 1))][Math.max(0, Math.min(c, t.align.length - 1))] };
}
/** The cell at an offset in a table's text; row 0 is the header (its separator line too). */
export function tableCellAt(tb, off) {
  let li = 0, start = 0;
  for (; li < tb.lines.length - 1 && off > start + tb.lines[li].length; li++) start += tb.lines[li].length + 1;
  const line = tb.lines[li], upto = Math.max(0, off - start);
  let pipes = 0;
  for (let i = 0; i < upto && i < line.length; i++) { if (line[i] === "\\") i++; else if (line[i] === "|") pipes++; }
  if (/^\s*\|/.test(line)) pipes--;
  return { row: li < 2 ? 0 : li - 1, col: Math.max(0, Math.min(pipes, parseTable(tb.lines).align.length - 1)) };
}
/** Each op changes the table and returns the cell to put the caret in ([row, col]), or "delete" for no table left. */
export const TABLE_OPS = {
  rowAbove: (t, r, c) => { t.rows.splice(Math.max(1, r), 0, t.align.map(() => "")); return [Math.max(1, r), c]; },
  rowBelow: (t, r, c) => { t.rows.splice(r + 1, 0, t.align.map(() => "")); return [r + 1, c]; },
  rowUp: (t, r, c) => { if (r < 2) return [r, c]; [t.rows[r - 1], t.rows[r]] = [t.rows[r], t.rows[r - 1]]; return [r - 1, c]; },
  rowDown: (t, r, c) => { if (r < 1 || r >= t.rows.length - 1) return [r, c]; [t.rows[r + 1], t.rows[r]] = [t.rows[r], t.rows[r + 1]]; return [r + 1, c]; },
  rowDelete: (t, r, c) => { if (t.rows.length < 2) return "delete"; t.rows.splice(r, 1); return [Math.min(r, t.rows.length - 1), c]; },
  colLeft: (t, r, c) => { t.rows.forEach((x) => x.splice(c, 0, "")); t.align.splice(c, 0, ""); return [r, c]; },
  colRight: (t, r, c) => { t.rows.forEach((x) => x.splice(c + 1, 0, "")); t.align.splice(c + 1, 0, ""); return [r, c + 1]; },
  colMoveLeft: (t, r, c) => { if (c < 1) return [r, c]; for (const x of [...t.rows, t.align]) [x[c - 1], x[c]] = [x[c], x[c - 1]]; return [r, c - 1]; },
  colMoveRight: (t, r, c) => { if (c >= t.align.length - 1) return [r, c]; for (const x of [...t.rows, t.align]) [x[c + 1], x[c]] = [x[c], x[c + 1]]; return [r, c + 1]; },
  colDelete: (t, r, c) => { if (t.align.length < 2) return "delete"; t.rows.forEach((x) => x.splice(c, 1)); t.align.splice(c, 1); return [r, Math.min(c, t.align.length - 1)]; },
  alignLeft: (t, r, c) => { t.align[c] = "left"; return [r, c]; },
  alignCenter: (t, r, c) => { t.align[c] = "center"; return [r, c]; },
  alignRight: (t, r, c) => { t.align[c] = "right"; return [r, c]; },
  // sorting keeps the header and puts empty cells last; numbers sort as numbers
  sortAsc: (t, r, c) => { t.rows = [t.rows[0], ...t.rows.slice(1).sort((a, b) => Number(!a[c]) - Number(!b[c]) || a[c].localeCompare(b[c], undefined, { numeric: true, sensitivity: "base" }))]; return [r, c]; },
  sortDesc: (t, r, c) => { t.rows = [t.rows[0], ...t.rows.slice(1).sort((a, b) => Number(!a[c]) - Number(!b[c]) || b[c].localeCompare(a[c], undefined, { numeric: true, sensitivity: "base" }))]; return [r, c]; },
  format: (t, r, c) => [r, c],
};
/** TABLE_OPS[op] on table `tb` of `text`: replace [from, to) with `insert`; `sel` is the caret cell's text in the new text. */
export function tableEdit(text, tb, op, row, col) {
  const t = parseTable(tb.lines), res = TABLE_OPS[op](t, row, col);
  if (res === "delete") return { from: tb.from, to: text[tb.to] === "\n" ? tb.to + 1 : tb.to, insert: "", sel: [tb.from, tb.from] };
  const f = formatTable(t), [s, e] = f.cell(...res);
  return { from: tb.from, to: tb.to, insert: f.text, sel: [tb.from + s, tb.from + e] };
}

/* ---------- Ranges of cells: a selection in a rendered table is a rectangle { r0, c0, r1, c1 } (inclusive, r0 <= r1, c0 <= c1).
   Its ops work as the single-cell ones above, over every row or column of the rectangle, and return the rectangle to select after
   (for an insert: the new row's or column's cell to edit), or "delete" for no table left. */
/** The rectangle between two cells, inside the table. */
export function tableRect(t, a, b) {
  const lr = t.rows.length - 1, lc = t.align.length - 1, cl = (v, n) => Math.max(0, Math.min(v, n));
  return { r0: cl(Math.min(a[0], b[0]), lr), r1: cl(Math.max(a[0], b[0]), lr), c0: cl(Math.min(a[1], b[1]), lc), c1: cl(Math.max(a[1], b[1]), lc) };
}
/** Rows r0..r1 moved to go before row `to` (an index in the table as it was); the header stays first. */
function moveRows(t, s, to) {
  const n = s.r1 - s.r0 + 1;
  if (s.r0 < 1 || to < 1 || (to >= s.r0 && to <= s.r1 + 1)) return s;
  const block = t.rows.splice(s.r0, n), at = to > s.r1 ? to - n : to;
  t.rows.splice(at, 0, ...block);
  return { ...s, r0: at, r1: at + n - 1 };
}
/** Columns c0..c1 moved to go before column `to` (an index in the table as it was), with their alignment. */
function moveCols(t, s, to) {
  const n = s.c1 - s.c0 + 1;
  if (to < 0 || (to >= s.c0 && to <= s.c1 + 1)) return s;
  const at = to > s.c1 ? to - n : to;
  for (const x of [...t.rows, t.align]) x.splice(at, 0, ...x.splice(s.c0, n));
  return { ...s, c0: at, c1: at + n - 1 };
}
export const TABLE_RANGE_OPS = {
  rowAbove: (t, s) => { const at = Math.max(1, s.r0); t.rows.splice(at, 0, t.align.map(() => "")); return { r0: at, r1: at, c0: s.c0, c1: s.c0 }; },
  rowBelow: (t, s) => { const at = s.r1 + 1; t.rows.splice(at, 0, t.align.map(() => "")); return { r0: at, r1: at, c0: s.c0, c1: s.c0 }; },
  colLeft: (t, s) => { t.rows.forEach((x) => x.splice(s.c0, 0, "")); t.align.splice(s.c0, 0, ""); return { r0: s.r0, r1: s.r0, c0: s.c0, c1: s.c0 }; },
  colRight: (t, s) => { const at = s.c1 + 1; t.rows.forEach((x) => x.splice(at, 0, "")); t.align.splice(at, 0, ""); return { r0: s.r0, r1: s.r0, c0: at, c1: at }; },
  rowUp: (t, s) => moveRows(t, s, s.r0 - 1),
  rowDown: (t, s) => (s.r1 < t.rows.length - 1 ? moveRows(t, s, s.r1 + 2) : s),
  colMoveLeft: (t, s) => moveCols(t, s, s.c0 - 1),
  colMoveRight: (t, s) => (s.c1 < t.align.length - 1 ? moveCols(t, s, s.c1 + 2) : s),
  moveRows,
  moveCols,
  // the header row stays: deleting rows takes the body rows of the rectangle
  rowDelete: (t, s) => {
    const a = Math.max(1, s.r0);
    if (a > s.r1) return s;
    t.rows.splice(a, s.r1 - a + 1);
    const r = Math.min(a, t.rows.length - 1);
    return { ...s, r0: r, r1: r };
  },
  colDelete: (t, s) => {
    if (s.c0 === 0 && s.c1 >= t.align.length - 1) return "delete";
    t.rows.forEach((x) => x.splice(s.c0, s.c1 - s.c0 + 1)); t.align.splice(s.c0, s.c1 - s.c0 + 1);
    const c = Math.min(s.c0, t.align.length - 1);
    return { ...s, c0: c, c1: c };
  },
  alignLeft: (t, s) => { t.align.fill("left", s.c0, s.c1 + 1); return s; },
  alignCenter: (t, s) => { t.align.fill("center", s.c0, s.c1 + 1); return s; },
  alignRight: (t, s) => { t.align.fill("right", s.c0, s.c1 + 1); return s; },
  sortAsc: (t, s) => { TABLE_OPS.sortAsc(t, 0, s.c0); return s; },
  sortDesc: (t, s) => { TABLE_OPS.sortDesc(t, 0, s.c0); return s; },
  clear: (t, s) => { for (let r = s.r0; r <= s.r1; r++) t.rows[r].fill("", s.c0, s.c1 + 1); return s; },
  /** `grid` (rows of cell text, as in the note) from the rectangle's top left cell, the table growing to hold it;
     a single value fills the whole rectangle, as in a spreadsheet. */
  paste: (t, s, grid) => {
    if (!grid?.length) return s;
    if (grid.length === 1 && grid[0].length === 1) { for (let r = s.r0; r <= s.r1; r++) t.rows[r].fill(grid[0][0], s.c0, s.c1 + 1); return s; }
    const w = Math.max(...grid.map((g) => g.length)), cols = s.c0 + w;
    while (t.align.length < cols) { t.align.push(""); t.rows.forEach((x) => x.push("")); }
    while (t.rows.length < s.r0 + grid.length) t.rows.push(t.align.map(() => ""));
    grid.forEach((g, i) => g.forEach((v, j) => { t.rows[s.r0 + i][s.c0 + j] = v; }));
    return { r0: s.r0, r1: s.r0 + grid.length - 1, c0: s.c0, c1: cols - 1 };
  },
  format: (t, s) => s,
};
/** TABLE_RANGE_OPS[op] on table `tb` of `text`, over rectangle `s`: replace [from, to) with `insert`; `rect` is what to select after. */
export function tableRangeEdit(text, tb, op, s, arg) {
  const t = parseTable(tb.lines), res = TABLE_RANGE_OPS[op](t, tableRect(t, [s.r0, s.c0], [s.r1, s.c1]), arg);
  if (res === "delete") return { from: tb.from, to: text[tb.to] === "\n" ? tb.to + 1 : tb.to, insert: "", rect: null };
  return { from: tb.from, to: tb.to, insert: formatTable(t).text, rect: res };
}
/** A cell's text as it reads (escaped pipes and <br> undone), and back as it goes into the note. */
export const cellPlain = (raw) => raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
export const cellRaw = (text) => text.replace(/\r?\n/g, "<br>").replace(/\\?\|/g, (m) => (m.length > 1 ? m : "\\|"));
/** The cells of a rectangle, as they are in the note. */
export const tableGrid = (t, s) => t.rows.slice(s.r0, s.r1 + 1).map((r) => r.slice(s.c0, s.c1 + 1));
/** Cells as a Markdown table of their own (the first row its header), or the text of a single cell. */
export function gridMarkdown(grid) {
  if (grid.length === 1 && grid[0].length === 1) return cellPlain(grid[0][0]);
  return formatTable({ rows: grid.map((r) => [...r]), align: grid[0].map(() => "") }).text;
}
/** Tab-separated values, as a spreadsheet copies them: a value in quotes may hold tabs, line breaks and doubled quotes. */
function parseTsv(text) {
  const rows = [[]];
  let cell = "", i = 0;
  const s = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  while (i <= s.length) {
    if (cell === "" && s[i] === '"') {
      let j = i + 1, v = "";
      for (; j < s.length; j++) { if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j++; } else break; } else v += s[j]; }
      if (j < s.length && (j + 1 >= s.length || s[j + 1] === "\t" || s[j + 1] === "\n")) { cell = v; i = j + 1; continue; }
    }
    const ch = s[i];
    if (ch === "\t" || ch === "\n" || i === s.length) { rows.at(-1).push(cell); cell = ""; if (ch === "\n") rows.push([]); i++; continue; }
    cell += ch; i++;
  }
  return rows;
}
/** Pasted text as cells (in the note's form), or null when it is plain text for one cell: a Markdown table (its header a row too)
   or tab-separated values from a spreadsheet. */
export function clipboardGrid(text) {
  const s = text.replace(/\r\n?/g, "\n").trim();
  const tb = findTables(s);
  if (tb.length === 1 && tb[0].from === 0 && tb[0].to === s.length) return parseTable(tb[0].lines).rows;
  if (!text.includes("\t")) return null;
  const rows = parseTsv(text).map((r) => r.map((v) => cellRaw(v.trim())));
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ""));
}
