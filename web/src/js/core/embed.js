/* =========================================================
   Embedded notes (![[Note]], ![[Note#Heading]]): which part of a note an embed shows, and how deep embeds go.
   ui/markdown.js draws them.
   ========================================================= */

/** Embeds inside embeds go this many levels deep; one further down is shown as a link. */
export const EMBED_DEPTH = 3;

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const headingKey = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The part of a note's body an embed shows: all of it without a heading, or the section under `heading` — that heading
 * and everything down to the next heading of the same or a higher level. Null when the note has no such heading.
 * Headings inside fenced code are not headings.
 */
export function embedSection(body, heading) {
  if (!heading || !heading.trim()) return body;
  const want = headingKey(heading);
  const lines = body.split("\n");
  let fence = null, start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE_RE.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = HEADING_RE.exec(lines[i]);
    if (!m) continue;
    if (start < 0) { if (headingKey(m[2]) === want) { start = i; level = m[1].length; } }
    else if (m[1].length <= level) return lines.slice(start, i).join("\n").replace(/\s+$/, "") + "\n";
  }
  return start < 0 ? null : lines.slice(start).join("\n").replace(/\s+$/, "") + "\n";
}

/**
 * Should an embed of `path` be drawn, `depth` levels down from the note being shown, with `chain` the notes
 * already open around it (the note itself first)? Not when it would go deeper than EMBED_DEPTH or round a cycle.
 */
export function embedAllowed(path, depth, chain) {
  if (depth >= EMBED_DEPTH) return "depth";
  if (chain.includes(path)) return "cycle";
  return null;
}
