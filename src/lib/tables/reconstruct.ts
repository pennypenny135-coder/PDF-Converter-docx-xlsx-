/**
 * Table reconstruction: RawTable (geometry + text items per cell)
 *   → ExtractedTable (editable model with header, columns, rows, per-cell metadata).
 *
 * Steps
 *  1. Cell text = items of the cell, grouped in lines and joined (see itemsToText).
 *  2. Spans: every grid position gets a Cell; positions swallowed by a merged cell
 *     are flagged `covered` and stay empty.
 *  3. Header detection (see detectHeader) – first row becomes column names.
 *  4. Per-cell `suspect` reasons carried over from detection are kept, type
 *     mismatches are computed lazily in tableModel.cellIssues().
 */
import { itemsToText, uid } from "../text";
import type { Cell, Column, ExtractedTable, RawTable, Row } from "../types";
import { parseValue } from "../valueParse";

const YEAR_RE = /^(19|20)\d{2}$/;

/** Is the string "data-like" (number/currency/percent/date, excluding bare years)? */
function isDataLike(s: string): boolean {
  const t = s.trim();
  if (!t || YEAR_RE.test(t)) return false;
  const k = parseValue(t).kind;
  return k === "number" || k === "currency" || k === "percent" || k === "date";
}

/**
 * Decide whether the first row is a header.
 *  - a row that contains numeric/date values is data, not a header
 *  - a mostly-filled, all-text first row above ≥1 other rows is a header
 *  - bold first row (when body isn't bold) is a strong header hint
 */
export function detectHeader(grid: string[][], firstRowBold: boolean, bodyBold: boolean): boolean {
  if (grid.length < 2) return false;
  const first = grid[0];
  const nonEmpty = first.filter((c) => c.trim()).length;
  if (nonEmpty < Math.ceil(first.length / 2)) return false;
  if (first.some(isDataLike)) return false;
  if (firstRowBold && !bodyBold) return true;
  return true;
}

export interface BuildOptions {
  name: string;
  forceNoHeader?: boolean;
}

export function buildTable(raw: RawTable, opts: BuildOptions): ExtractedTable {
  const { nRows, nCols } = raw;
  const grid: Cell[][] = Array.from({ length: nRows }, (_, r) =>
    Array.from({ length: nCols }, (_, c) => ({
      id: uid("c"),
      original: "",
      value: "",
      status: "auto" as const,
      suspect: [],
      rowSpan: 1,
      colSpan: 1,
      covered: false,
      rect: { x0: raw.colEdges[c], y0: raw.rowEdges[r], x1: raw.colEdges[c + 1], y1: raw.rowEdges[r + 1] },
      page: raw.page,
    })),
  );
  const boldByRow: number[] = Array(nRows).fill(0);
  const charsByRow: number[] = Array(nRows).fill(0);

  for (const rc of raw.cells) {
    const text = itemsToText(rc.items);
    const cell = grid[rc.row][rc.col];
    cell.original = text;
    cell.value = text;
    cell.suspect = [...new Set(rc.suspect)];
    cell.rowSpan = rc.rowSpan;
    cell.colSpan = rc.colSpan;
    cell.rect = rc.rect;
    for (let r = rc.row; r < rc.row + rc.rowSpan; r++) {
      for (let c = rc.col; c < rc.col + rc.colSpan; c++) {
        if (r === rc.row && c === rc.col) continue;
        grid[r][c].covered = true;
      }
    }
    for (const it of rc.items) {
      const n = it.str.length;
      charsByRow[rc.row] += n;
      if (it.bold) boldByRow[rc.row] += n;
    }
  }

  const textGrid = grid.map((row) => row.map((c) => c.value));
  const bold = (r: number) => charsByRow[r] > 0 && boldByRow[r] / charsByRow[r] > 0.6;
  const bodyBold = nRows > 1 && Array.from({ length: nRows - 1 }, (_, i) => bold(i + 1)).filter(Boolean).length > (nRows - 1) / 2;
  const hasHeader = !opts.forceNoHeader && detectHeader(textGrid, bold(0), bodyBold);

  const columns: Column[] = Array.from({ length: nCols }, (_, c) => {
    const h = hasHeader ? grid[0][c] : null;
    const name = h && h.value.trim() ? h.value.trim() : `Column ${c + 1}`;
    return {
      id: uid("col"),
      name,
      originalName: name,
      nameStatus: "auto",
      type: "auto",
      rect: h?.rect,
      page: raw.page,
    };
  });

  const bodyStart = hasHeader ? 1 : 0;
  const rows: Row[] = [];
  for (let r = bodyStart; r < nRows; r++) {
    // header spans are flattened; body spans are kept relative to the body rows
    const cells = grid[r].map((c) => ({ ...c, rowSpan: Math.min(c.rowSpan, nRows - r) }));
    rows.push({
      id: uid("r"),
      page: raw.page,
      rect: { x0: raw.bbox.x0, y0: raw.rowEdges[r], x1: raw.bbox.x1, y1: raw.rowEdges[r + 1] },
      cells,
    });
  }

  // after removing the header, spans that started inside it must not leak
  if (hasHeader) for (const c of grid[0]) c.colSpan = 1;

  return {
    id: uid("t"),
    name: opts.name,
    source: raw.source,
    regions: [{ page: raw.page, rect: raw.bbox }],
    columns,
    rows,
    hasHeader,
    baseConfidence: raw.confidence,
    included: true,
    notes: raw.notes,
    colEdges: raw.colEdges,
  };
}
