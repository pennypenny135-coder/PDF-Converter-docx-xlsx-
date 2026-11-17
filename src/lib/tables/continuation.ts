/**
 * Multi-page table continuation detection.
 *
 * Table B continues table A when:
 *   - B starts on the page right after A's last page,
 *   - A ends in the lower part of its page and B starts in the upper part of its page,
 *   - they have the same number of columns, and
 *   - the column x-edges line up (mean distance ≤ 12pt) when both are known.
 * A repeated header row in B is removed by mergeTables().
 */
import type { ExtractedTable, PageData } from "../types";

export interface ContinuationSuggestion {
  aId: string;
  bId: string;
  score: number;
}

export function suggestContinuations(tables: ExtractedTable[], pages: Pick<PageData, "pageNumber" | "height">[]): ContinuationSuggestion[] {
  const heightOf = (n: number) => pages.find((p) => p.pageNumber === n)?.height ?? 842;
  const out: ContinuationSuggestion[] = [];
  const taken = new Set<string>();

  for (const b of tables) {
    const bFirst = b.regions[0];
    if (!bFirst) continue;
    const candidates = tables.filter((a) => {
      if (a.id === b.id || taken.has(a.id)) return false;
      const aLast = a.regions[a.regions.length - 1];
      return aLast && aLast.page === bFirst.page - 1;
    });
    let best: ContinuationSuggestion | null = null;
    for (const a of candidates) {
      const aLast = a.regions[a.regions.length - 1];
      if (a.columns.length !== b.columns.length) continue;
      const endsLow = aLast.rect.y1 > heightOf(aLast.page) * 0.55;
      const startsHigh = bFirst.rect.y0 < heightOf(bFirst.page) * 0.45;
      if (!endsLow || !startsHigh) continue;
      let score = 0.6;
      if (a.colEdges.length === b.colEdges.length && a.colEdges.length > 1) {
        const d = a.colEdges.reduce((s, x, i) => s + Math.abs(x - b.colEdges[i]), 0) / a.colEdges.length;
        if (d > 12) continue;
        score += 0.3 * (1 - d / 12);
      }
      if (b.hasHeader && b.columns.every((c, i) => c.name.trim().toLowerCase() === a.columns[i].name.trim().toLowerCase())) score += 0.1;
      if (!best || score > best.score) best = { aId: a.id, bId: b.id, score };
    }
    if (best) {
      out.push(best);
      taken.add(best.aId);
    }
  }
  return out;
}
