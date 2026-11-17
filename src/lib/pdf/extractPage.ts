/**
 * PDF text extraction for a single page → `PageData` (see lib/types.ts).
 *
 * Coordinate conversion (see lib/coords.ts for the full story):
 *   PDF.js text items carry `transform = [a b c d e f]` in PDF user space where
 *   (e, f) is the BASELINE origin of the run and |(c, d)| is the font size. We
 *   push (e, f) through `viewport.transform` (scale 1) which flips the y axis,
 *   giving a top-left based baseline y. The glyph box is then approximated as
 *     top    = baseline − 0.8·fontSize   (ascent)
 *     bottom = baseline + 0.2·fontSize   (descent)
 *   which keeps boxes of adjacent lines from overlapping.
 */
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyMatrix, type Matrix } from "../coords";
import type { PageData, TextItem } from "../types";
import { extractGraphics, type OpsTable } from "./graphics";

const BOLD_RE = /bold|black|heavy|semibold|demi|粗/i;
const ITALIC_RE = /italic|oblique|slanted|斜/i;

/** A page with less than this many visible characters is considered to have no text layer. */
export const MIN_CHARS_FOR_TEXT_PAGE = 8;

interface FontInfo {
  name: string;
  bold: boolean;
  italic: boolean;
}

function readFont(page: PDFPageProxy, id: string, cache: Map<string, FontInfo>): FontInfo {
  const hit = cache.get(id);
  if (hit) return hit;
  let info: FontInfo = { name: id, bold: false, italic: false };
  try {
    // commonObjs.get() throws if the font is not resolved yet — we call getOperatorList() first which resolves them.
    if (page.commonObjs.has(id)) {
      const f = page.commonObjs.get(id) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean } | null;
      const name = f?.name ?? id;
      info = { name, bold: !!(f?.bold || f?.black) || BOLD_RE.test(name), italic: !!f?.italic || ITALIC_RE.test(name) };
    }
  } catch {
    /* keep defaults */
  }
  cache.set(id, info);
  return info;
}

export async function extractPage(page: PDFPageProxy, ops: OpsTable): Promise<PageData> {
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;

  // 1) Operator list first: draws lines/images AND makes PDF.js resolve the fonts we query below.
  let rules: PageData["rules"] = [];
  let images: PageData["images"] = [];
  try {
    const opList = await page.getOperatorList();
    const g = extractGraphics(opList.fnArray, opList.argsArray, ops, vt);
    rules = g.rules;
    images = g.images;
  } catch {
    /* graphics are optional — text-only extraction still works */
  }

  // 2) Text content
  const content = await page.getTextContent({ includeMarkedContent: false });
  const fonts = new Map<string, FontInfo>();
  const items: TextItem[] = [];
  let charCount = 0;
  let n = 0;
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const str = raw.str;
    if (!str || !str.trim()) continue;
    const tr = raw.transform as number[];
    const fontSize = Math.hypot(tr[2], tr[3]) || raw.height || 10;
    const [x, baseline] = applyMatrix(vt, tr[4], tr[5]);
    const width = Math.abs(raw.width) || str.length * fontSize * 0.5;
    const font = readFont(page, raw.fontName, fonts);
    charCount += str.replace(/\s/g, "").length;
    items.push({
      id: `p${page.pageNumber}-t${n++}`,
      str,
      x0: x,
      x1: x + width,
      y0: baseline - fontSize * 0.8,
      y1: baseline + fontSize * 0.2,
      fontSize,
      bold: font.bold,
      italic: font.italic,
      fontName: font.name,
    });
  }

  const pageArea = viewport.width * viewport.height;
  const hasBigImage = images.some((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > pageArea * 0.2);
  return {
    pageNumber: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    items,
    rules,
    images: images.filter((r) => r.x1 - r.x0 > 12 && r.y1 - r.y0 > 12),
    charCount,
    looksScanned: charCount < MIN_CHARS_FOR_TEXT_PAGE && (hasBigImage || images.length > 0),
  };
}

export interface DocumentTextSummary {
  totalPages: number;
  textPages: number;
  scannedPages: number;
  blankPages: number;
  /** true when more than half of the pages have no usable text layer */
  isScanned: boolean;
  /** true when at least one page is scanned but not all */
  partiallyScanned: boolean;
}

/** Decide whether the document is text-based, scanned, or mixed. */
export function summarizeDocument(pages: PageData[]): DocumentTextSummary {
  const scanned = pages.filter((p) => p.looksScanned).length;
  const text = pages.filter((p) => p.charCount >= MIN_CHARS_FOR_TEXT_PAGE).length;
  const blank = pages.length - scanned - text;
  const isScanned = pages.length > 0 && text === 0 ? true : scanned > pages.length / 2;
  return {
    totalPages: pages.length,
    textPages: text,
    scannedPages: scanned,
    blankPages: blank,
    isScanned,
    partiallyScanned: !isScanned && scanned > 0,
  };
}
