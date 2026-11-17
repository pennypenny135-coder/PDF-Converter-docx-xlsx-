/**
 * Manual region extraction – what happens when the user drags a rectangle on a page
 * and assigns it to a table, paragraph, heading or an Excel column.
 *
 * The region rectangle is in page points (top-left origin); see lib/coords.ts for
 * the mapping from screen pixels.
 */
import { containsPoint, overlapRatio, rectCenter } from "./coords";
import { buildTextBlocks } from "./paragraphs";
import { buildLines, lineText } from "./text";
import { detectBorderedTables } from "./tables/detectBordered";
import { detectBorderlessTables } from "./tables/detectBorderless";
import { buildTable } from "./tables/reconstruct";
import type { DetectionSettings, ExtractedTable, PageData, RawCell, RawTable, Rect, TextBlock, TextItem } from "./types";

export const itemsInRegion = (page: PageData, rect: Rect): TextItem[] =>
  page.items.filter((it) => {
    const [cx, cy] = rectCenter(it);
    return containsPoint(rect, cx, cy);
  });

/** Clip a bordered table to the region: keep only cells whose centre is inside. */
function clipRawTable(raw: RawTable, rect: Rect): RawTable | null {
  if (overlapRatio(raw.bbox, rect) > 0.85) return raw;
  const kept = raw.cells.filter((c) => {
    const [cx, cy] = rectCenter(c.rect);
    return containsPoint(rect, cx, cy);
  });
  if (!kept.length) return null;
  const rows = [...new Set(kept.map((c) => c.row))].sort((a, b) => a - b);
  const cols = [...new Set(kept.map((c) => c.col))].sort((a, b) => a - b);
  const rMap = new Map(rows.map((r, i) => [r, i]));
  const cMap = new Map(cols.map((c, i) => [c, i]));
  const cells: RawCell[] = kept.map((c) => ({ ...c, row: rMap.get(c.row)!, col: cMap.get(c.col)!, rowSpan: 1, colSpan: 1 }));
  const rowEdges = [...rows.map((r) => raw.rowEdges[r]), raw.rowEdges[rows[rows.length - 1] + 1]];
  const colEdges = [...cols.map((c) => raw.colEdges[c]), raw.colEdges[cols[cols.length - 1] + 1]];
  return {
    ...raw,
    nRows: rows.length,
    nCols: cols.length,
    rowEdges,
    colEdges,
    cells,
    bbox: { x0: colEdges[0], y0: rowEdges[0], x1: colEdges[colEdges.length - 1], y1: rowEdges[rowEdges.length - 1] },
    confidence: raw.confidence - 0.05,
  };
}

/**
 * Region → table. Strategy, in order:
 *  1. bordered table overlapping the region (clipped to it),
 *  2. borderless detection restricted to text inside the region,
 *  3. forced line/column split (always returns something if the region has text).
 */
export function extractRegionTable(page: PageData, rect: Rect, settings: DetectionSettings, name: string): ExtractedTable | null {
  const inside = itemsInRegion(page, rect);
  if (!inside.length) return null;

  let raw: RawTable | null = null;
  if (settings.detectBordered) {
    const bordered = detectBorderedTables(page)
      .filter((t) => overlapRatio(t.bbox, rect) > 0.05 || overlapRatio(rect, t.bbox) > 0.5)
      .sort((a, b) => overlapRatio(b.bbox, rect) - overlapRatio(a.bbox, rect));
    for (const t of bordered) {
      const clipped = clipRawTable(t, rect);
      if (clipped && clipped.nCols >= 2) {
        raw = { ...clipped, source: "manual" };
        break;
      }
    }
  }
  if (!raw) {
    const base = { columnGapEm: settings.columnGapEm, minCols: 2, items: inside };
    const auto = detectBorderlessTables(page, { ...base, minRows: 2 });
    if (auto.length) {
      raw = { ...auto.sort((a, b) => b.nRows * b.nCols - a.nRows * a.nCols)[0], source: "manual" };
    } else {
      raw = detectBorderlessTables(page, { ...base, minRows: 1, force: true })[0] ?? null;
    }
  }
  if (!raw) return null;
  return buildTable(raw, { name });
}

export function extractRegionBlock(
  page: PageData,
  rect: Rect,
  target: { kind: "heading"; level: 1 | 2 | 3 } | { kind: "paragraph" },
  bodyFontSize: number,
): TextBlock | null {
  const items = itemsInRegion(page, rect);
  if (!items.length) return null;
  const blocks = buildTextBlocks(page, items, {
    bodyFontSize,
    manualKind: { kind: target.kind, level: target.kind === "heading" ? target.level : 3 },
  });
  return blocks[0] ? { ...blocks[0], manual: true } : null;
}

/** Region → ordered list of single-line values with their y position (for column assignment). */
export function extractRegionLines(page: PageData, rect: Rect): { value: string; y: number; page: number }[] {
  return buildLines(itemsInRegion(page, rect)).map((l) => ({ value: lineText(l.items), y: l.cy, page: page.pageNumber }));
}
