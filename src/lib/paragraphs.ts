/**
 * Paragraph / heading / list reconstruction from text items.
 *
 *  - Lines come from y-clustering (text.ts buildLines).
 *  - A line is a HEADING when its font is clearly larger than the body font, or it is a
 *    short, fully bold line without sentence punctuation, or matches "第X章".
 *  - Bullet and numbered LIST items are recognised by their markers; indented lines that
 *    follow are continuation lines of the item.
 *  - Remaining lines are merged into PARAGRAPHS while the vertical gap is small.
 *  - Bold/italic runs are kept so the Word export can preserve basic character styling.
 */
import { buildLines, isCJK, median, uid, type TextLine } from "./text";
import { containsPoint, intersection, rectArea } from "./coords";
import type { BlockKind, ImageBlock, PageData, Rect, TextBlock, TextItem, TextRun } from "./types";

const BULLET_RE = /^\s*([•·●○◦▪■□◆◇▶►‣⁃*]|[-–—](?=\s))\s*/;
const NUM_LATIN_RE = /^\s*(\(?\d{1,3}[.)]|[a-zA-Z][.)])\s+/;
const NUM_CJK_RE = /^\s*([（(][一二三四五六七八九十\d]+[）)]|[一二三四五六七八九十]+、|\d{1,3}、)\s*/;
const CHAPTER_RE = /^第[一二三四五六七八九十百零\d]+[章节篇部]/;

/** Most common font size by character count (ignores tiny footnotes / big titles). */
export function computeBodyFontSize(pages: Pick<PageData, "items">[]): number {
  const hist = new Map<number, number>();
  for (const p of pages) {
    for (const it of p.items) {
      const k = Math.round(it.fontSize * 2) / 2;
      hist.set(k, (hist.get(k) ?? 0) + it.str.length);
    }
  }
  let best = 10;
  let bestN = -1;
  hist.forEach((n, k) => {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  });
  return best;
}

/** Build styled runs for one line, inserting a space only at real gaps (CJK-aware). */
export function lineRuns(items: TextItem[]): TextRun[] {
  const runs: TextRun[] = [];
  let prev: TextItem | null = null;
  const push = (text: string, it: TextItem) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === it.bold && last.italic === it.italic) last.text += text;
    else runs.push({ text, bold: it.bold, italic: it.italic });
  };
  for (const it of items) {
    let text = it.str.replace(/\s+/g, " ");
    if (prev) {
      const gap = it.x0 - prev.x1;
      const needSpace = gap > Math.max(0.12 * it.fontSize, 0.8) && !isCJK(prev.str.slice(-1)) && !isCJK(text[0]);
      if (needSpace && !/\s$/.test(prev.str) && !/^\s/.test(text)) text = " " + text;
    }
    push(text, it);
    prev = it;
  }
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((r) => r.text);
}

const runsText = (runs: TextRun[]) => runs.map((r) => r.text).join("");

interface LineInfo {
  line: TextLine;
  runs: TextRun[];
  text: string;
  boldRatio: number;
  italicRatio: number;
}

function describe(line: TextLine): LineInfo {
  const runs = lineRuns(line.items);
  const chars = line.items.reduce((n, i) => n + i.str.length, 0) || 1;
  const bold = line.items.reduce((n, i) => n + (i.bold ? i.str.length : 0), 0);
  const ital = line.items.reduce((n, i) => n + (i.italic ? i.str.length : 0), 0);
  return { line, runs, text: runsText(runs), boldRatio: bold / chars, italicRatio: ital / chars };
}

function classify(info: LineInfo, body: number): { kind: BlockKind; level: 1 | 2 | 3; marker?: string } {
  const { text, line } = info;
  const bullet = text.match(BULLET_RE);
  if (bullet && text.length > bullet[0].length) return { kind: "list-bullet", level: 3, marker: bullet[0] };
  const num = text.match(NUM_LATIN_RE) ?? text.match(NUM_CJK_RE);
  if (num && text.length > num[0].length && line.fontSize <= body * 1.15) return { kind: "list-number", level: 3, marker: num[0] };

  const ratio = line.fontSize / body;
  const short = text.length <= 120;
  if (CHAPTER_RE.test(text) && short) return { kind: "heading", level: ratio >= 1.5 ? 1 : 2 };
  if (ratio >= 1.18 && short) return { kind: "heading", level: ratio >= 1.75 ? 1 : ratio >= 1.4 ? 2 : 3 };
  if (info.boldRatio > 0.9 && text.length <= 80 && ratio >= 0.95 && !/[.。;；,，:：]$/.test(text)) return { kind: "heading", level: 3 };
  return { kind: "paragraph", level: 3 };
}

function appendRuns(base: TextRun[], add: TextRun[]): TextRun[] {
  if (!base.length) return add.map((r) => ({ ...r }));
  const out = base.map((r) => ({ ...r }));
  const last = out[out.length - 1];
  const lastCh = last.text[last.text.length - 1];
  const firstCh = add[0]?.text[0];
  if (!add.length) return out;
  if (lastCh === "-" && firstCh && /[a-z]/.test(firstCh)) {
    last.text = last.text.slice(0, -1); // de-hyphenate soft line-break
  } else if (!isCJK(lastCh) && !isCJK(firstCh)) {
    last.text += " ";
  }
  for (const r of add) {
    const l = out[out.length - 1];
    if (l.bold === r.bold && l.italic === r.italic) l.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export interface BlockOptions {
  bodyFontSize: number;
  /** items whose centre falls into one of these rects are skipped (already part of a table) */
  exclude?: Rect[];
  manualKind?: { kind: BlockKind; level: 1 | 2 | 3 };
}

export function buildTextBlocks(page: Pick<PageData, "pageNumber">, items: TextItem[], opts: BlockOptions): TextBlock[] {
  const pool = items.filter((it) => {
    const cx = (it.x0 + it.x1) / 2;
    const cy = (it.y0 + it.y1) / 2;
    return !opts.exclude?.some((r) => containsPoint(r, cx, cy, 1));
  });
  const infos = buildLines(pool).map(describe).filter((i) => i.text.trim());
  const body = opts.bodyFontSize || median(infos.map((i) => i.line.fontSize)) || 10;

  interface Acc {
    kind: BlockKind;
    level: 1 | 2 | 3;
    runs: TextRun[];
    rect: Rect;
    sizes: number[];
    lastLine: TextLine;
    boldAll: boolean;
    italicAll: boolean;
    leftX: number;
  }
  const accs: Acc[] = [];
  let cur: Acc | null = null;

  for (const info of infos) {
    const c = opts.manualKind ? { kind: opts.manualKind.kind, level: opts.manualKind.level, marker: undefined } : classify(info, body);
    let runs = info.runs;
    if (c.marker) {
      // strip the bullet; numbered markers are kept as text so numbering is preserved verbatim
      if (c.kind === "list-bullet") {
        runs = runs.map((r) => ({ ...r }));
        runs[0].text = runs[0].text.replace(BULLET_RE, "");
      }
    }
    const l = info.line;
    const gap = cur ? l.y0 - cur.lastLine.y1 : 0;
    const canJoin =
      !!cur &&
      !opts.manualKind &&
      gap <= 0.55 * l.fontSize &&
      Math.abs(l.fontSize - cur.lastLine.fontSize) / l.fontSize < 0.12 &&
      ((c.kind === "paragraph" && (cur.kind === "paragraph" || cur.kind === "list-bullet" || cur.kind === "list-number") && l.x0 >= cur.leftX - 3) ||
        (c.kind === "heading" && cur.kind === "heading" && c.level === cur.level));
    const manualJoin = !!cur && !!opts.manualKind;

    if (cur && (canJoin || manualJoin)) {
      cur.runs = appendRuns(cur.runs, runs);
      cur.rect = { x0: Math.min(cur.rect.x0, l.x0), y0: cur.rect.y0, x1: Math.max(cur.rect.x1, l.x1), y1: l.y1 };
      cur.sizes.push(l.fontSize);
      cur.lastLine = l;
      cur.boldAll = cur.boldAll && info.boldRatio > 0.9;
      cur.italicAll = cur.italicAll && info.italicRatio > 0.9;
    } else {
      cur = {
        kind: c.kind,
        level: c.level,
        runs: runs.map((r) => ({ ...r })),
        rect: { x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 },
        sizes: [l.fontSize],
        lastLine: l,
        boldAll: info.boldRatio > 0.9,
        italicAll: info.italicRatio > 0.9,
        leftX: l.x0,
      };
      accs.push(cur);
    }
  }

  return accs
    .map((a): TextBlock => {
      const text = runsText(a.runs).trim();
      return {
        id: uid("b"),
        page: page.pageNumber,
        kind: a.kind,
        level: a.level,
        original: text,
        text,
        runs: a.runs,
        fontSize: median(a.sizes),
        bold: a.boldAll,
        italic: a.italicAll,
        rect: a.rect,
        status: "auto",
        included: true,
        manual: !!opts.manualKind,
      };
    })
    .filter((b) => b.text);
}

/** Image placements worth exporting (skips full-page scans and tiny decorations). */
export function buildImageBlocks(page: PageData): ImageBlock[] {
  const area = page.width * page.height;
  return page.images
    .filter((r) => {
      const a = rectArea(r);
      return a > 900 && a < area * 0.85 && !page.looksScanned;
    })
    .map((r) => ({
      id: uid("img"),
      page: page.pageNumber,
      rect: intersection(r, { x0: 0, y0: 0, x1: page.width, y1: page.height }) ?? r,
      included: true,
    }));
}
