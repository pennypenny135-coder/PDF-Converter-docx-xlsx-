/**
 * Text helpers shared by the table + paragraph reconstruction code.
 * Handles Chinese/English mixed text: CJK characters are not separated by
 * spaces, Latin words are.
 */
import type { TextItem } from "./types";

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

export const isCJK = (ch: string | undefined): boolean => !!ch && CJK_RE.test(ch);

/** Display width: CJK characters count double (used for Excel column width). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += isCJK(ch) ? 2 : 1;
  return w;
}

/** Normalise full-width ASCII variants and odd whitespace. */
export function normalizeText(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, " ");
}

/** Join two text fragments with a space unless the boundary is CJK or already spaced. */
export function joinText(a: string, b: string, forceSpace = false): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  if (!forceSpace && (isCJK(a[a.length - 1]) || isCJK(b[0]))) return a + b;
  return a + " " + b;
}

/** A visual line of text items. */
export interface TextLine {
  items: TextItem[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cy: number;
  fontSize: number;
}

/**
 * Cluster items into visual lines.
 * Sort by vertical centre; an item joins the current line when its centre is
 * within 55% of the smaller height of the line's reference item. Inside a line
 * items are ordered left → right.
 */
export function buildLines(items: TextItem[]): TextLine[] {
  const usable = items.filter((i) => i.str.trim().length > 0);
  const sorted = [...usable].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const groups: TextItem[][] = [];
  let cy = 0;
  let ref = 0;
  for (const it of sorted) {
    const c = (it.y0 + it.y1) / 2;
    const h = Math.max(1, it.y1 - it.y0);
    const last = groups[groups.length - 1];
    if (last && Math.abs(c - cy) <= 0.55 * Math.min(ref, h)) {
      last.push(it);
      // running average keeps the centre stable
      cy = (cy * (last.length - 1) + c) / last.length;
    } else {
      groups.push([it]);
      cy = c;
      ref = h;
    }
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x0 - b.x0);
    const sizes = g.map((i) => i.fontSize).sort((a, b) => a - b);
    return {
      items: g,
      x0: Math.min(...g.map((i) => i.x0)),
      y0: Math.min(...g.map((i) => i.y0)),
      x1: Math.max(...g.map((i) => i.x1)),
      y1: Math.max(...g.map((i) => i.y1)),
      cy: (Math.min(...g.map((i) => i.y0)) + Math.max(...g.map((i) => i.y1))) / 2,
      fontSize: sizes[Math.floor(sizes.length / 2)] || 10,
    };
  });
}

/** Text of a single line (items already x-ordered); inserts spaces on real gaps. */
export function lineText(items: TextItem[]): string {
  let out = "";
  let prev: TextItem | null = null;
  for (const it of items) {
    if (!prev) {
      out = it.str;
    } else {
      const gap = it.x0 - prev.x1;
      const spaced = gap > Math.max(0.12 * it.fontSize, 0.8);
      out = joinText(out, it.str, spaced && !isCJK(prev.str.slice(-1)) && !isCJK(it.str[0]));
    }
    prev = it;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Text of a set of items (cell content): lines top→bottom joined by a space (or nothing for CJK). */
export function itemsToText(items: TextItem[]): string {
  const lines = buildLines(items);
  let out = "";
  for (const l of lines) {
    const t = lineText(l.items);
    if (!out) out = t;
    else if (out.endsWith("-") && /^[a-z]/.test(t)) out = out.slice(0, -1) + t; // de-hyphenate wrapped words
    else out = joinText(out, t, true);
  }
  return out.trim();
}

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
