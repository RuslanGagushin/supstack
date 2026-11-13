// Measures the contrast of the text on the page against what is drawn behind it (spec A11Y-3). The colours are resolved by
// painting them on a canvas, so whatever the stylesheet writes them in — color-mix(), color(), oklch() — they are compared
// as the pixels they become; the backgrounds behind a text are laid one over another the way the browser does.
// Run in the page: page.evaluate(contrastAudit, { min, minLarge }).

/** @returns {{ text: string, where: string, color: string, back: string, ratio: number, need: number }[]} */
export function contrastAudit({ min = 4.5, minLarge = 3, root = "body" } = {}) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const rgba = (c) => {
    if (memo.has(c)) return memo.get(c);
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const v = [r, g, b, a / 255];
    memo.set(c, v);
    return v;
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // what is painted behind an element: its own background and each ancestor's, from the page down
  const backOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let back = [255, 255, 255, 1];
    for (const l of layers.reverse()) back = over(l, back);
    return back;
  };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].slice(0, 3).map((c) => "." + c).join("");
  const out = [], seen = new Set();
  const walk = document.createTreeWalker(document.querySelector(root), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent.trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    if (s.visibility !== "visible" || el.closest("[aria-hidden=true], [hidden], svg, .cm-cursor, .sr-only")) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const box = range.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
    // drawn over by something else (a dialog's scrim): only what can be seen is measured
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, box.left + Math.min(box.width, 6) / 2)), Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2)));
    if (hit && !el.contains(hit) && !hit.contains(el)) continue;
    const op = opacityOf(el);
    if (op < 0.05) continue;
    const back = backOf(el);
    const fg = rgba(s.color);
    const color = over([fg[0], fg[1], fg[2], fg[3] * op], back);
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? minLarge : min;
    const r = ratio(color, back);
    if (r + 1e-6 < need) out.push({ text: text.slice(0, 40), where: name(el) + " < " + (el.parentElement ? name(el.parentElement) : ""), color: `rgb(${color.slice(0, 3).map(Math.round)})`, back: `rgb(${back.slice(0, 3).map(Math.round)})`, ratio: Math.round(r * 100) / 100, need });
  }
  return out;
}
