/* =========================================================
   Searching notes (spec §4.2): the query's words and tag filters, an index of the words in each note, and the order
   of the results. core/board-model.js uses it; services/vault.js keeps the index for the open vault.
   ========================================================= */
import { norm } from "./util.js";

const TAG_TOKEN = /^([+-])#?([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)$/u;
const WORD_SPLIT = /[^\p{L}\p{N}_]+/u;
const WORD_ONLY = /^[\p{L}\p{N}_]+$/u;

/**
 * A query as typed: the words to find (normalized), and the tags a note must have (+tag) and must not have (-tag).
 * A + or - before anything that is not a tag name stays a word ("-5", "+").
 */
export function parseQuery(q) {
  const out = { words: [], include: [], exclude: [] };
  for (const tok of norm(q).split(/\s+/).filter(Boolean)) {
    const m = TAG_TOKEN.exec(tok);
    if (m) (m[1] === "+" ? out.include : out.exclude).push(m[2]);
    else out.words.push(tok);
  }
  return out;
}

/**
 * The words in each note, to narrow a search down before the texts are read. A query word is found in a note when
 * it is part of one of the note's words, so the index gives every note a plain substring search would find, and
 * maybe a few more; the search then checks those against their text, so what it finds is exactly what it found
 * without the index. A query word with other characters ("c++", "a-b") can't be looked up and narrows nothing.
 */
export class WordIndex {
  /** `commonShare`: a word in more than this share of the notes is too common to narrow a search down. */
  constructor({ commonShare = 0.5 } = {}) {
    this.commonShare = commonShare;
    this.docs = new Map(); // path → { ref, words }
    this.postings = new Map(); // word → Set of paths
  }
  /** Index `text` for `path`; `ref` says which version it is (the note object), so an unchanged note is skipped. */
  set(path, ref, text) {
    const old = this.docs.get(path);
    if (old && old.ref === ref) return false;
    if (old) this.drop(path);
    const words = new Set(norm(text).split(WORD_SPLIT).filter(Boolean));
    for (const w of words) (this.postings.get(w) || this.postings.set(w, new Set()).get(w)).add(path);
    this.docs.set(path, { ref, words });
    return true;
  }
  drop(path) {
    const old = this.docs.get(path);
    if (!old) return;
    for (const w of old.words) { const s = this.postings.get(w); s.delete(path); if (!s.size) this.postings.delete(w); }
    this.docs.delete(path);
  }
  /** Bring it in line with `notes` (a Map path → note); `textOf(note)` is what is searched. Returns how many notes were (re)indexed. */
  update(notes, textOf) {
    let n = 0;
    for (const [path, note] of notes) if (this.set(path, note, textOf(note))) n++;
    if (this.docs.size > notes.size) for (const p of [...this.docs.keys()]) if (!notes.has(p)) this.drop(p);
    return n;
  }
  /**
   * The notes that may hold every one of `words`, or null when the index can't narrow them down: no word can be
   * looked up, or each is in most notes anyway, where reading the texts is quicker than gathering the matches.
   */
  candidates(words) {
    let result = null;
    const most = this.docs.size * this.commonShare;
    for (const w of words) {
      if (!WORD_ONLY.test(w)) continue;
      const hits = new Set();
      let common = false;
      for (const [word, paths] of this.postings) {
        if (!word.includes(w)) continue;
        for (const p of paths) hits.add(p);
        if (hits.size > most) { common = true; break; }
      }
      if (common) continue;
      result = result ? new Set([...result].filter((p) => hits.has(p))) : hits;
      if (!result.size) break;
    }
    return result;
  }
}

/** The headings of a note's text, as one string to search. */
export function headingsText(md) {
  let out = "";
  for (const m of String(md).matchAll(/^ {0,3}#{1,6}[ \t]+(.+)$/gm)) out += m[1] + "\n";
  return out;
}

/**
 * How well a found note matches (SRCH-2): 3 when its title has every word, 2 when its title and headings together
 * have them, 1 when only its text does.
 */
export function matchRank(words, title, headings) {
  const t = norm(title);
  if (words.every((w) => t.includes(w))) return 3;
  const th = t + "\n" + norm(headings);
  return words.every((w) => th.includes(w)) ? 2 : 1;
}
