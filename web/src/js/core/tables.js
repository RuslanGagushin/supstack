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
      return " " + (l ? ":" : "") + "-".repeat(w[i] - l - rt) + (rt ? ":" : "") + " |";
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
  sortAsc: (t, r, c) => { t.rows = [t.rows[0], ...t.rows.slice(1).sort((a, b) => !a[c] - !b[c] || a[c].localeCompare(b[c], undefined, { numeric: true, sensitivity: "base" }))]; return [r, c]; },
  sortDesc: (t, r, c) => { t.rows = [t.rows[0], ...t.rows.slice(1).sort((a, b) => !a[c] - !b[c] || b[c].localeCompare(a[c], undefined, { numeric: true, sensitivity: "base" }))]; return [r, c]; },
  format: (t, r, c) => [r, c],
};
/** TABLE_OPS[op] on table `tb` of `text`: replace [from, to) with `insert`; `sel` is the caret cell's text in the new text. */
export function tableEdit(text, tb, op, row, col) {
  const t = parseTable(tb.lines), res = TABLE_OPS[op](t, row, col);
  if (res === "delete") return { from: tb.from, to: text[tb.to] === "\n" ? tb.to + 1 : tb.to, insert: "", sel: [tb.from, tb.from] };
  const f = formatTable(t), [s, e] = f.cell(...res);
  return { from: tb.from, to: tb.to, insert: f.text, sel: [tb.from + s, tb.from + e] };
}
