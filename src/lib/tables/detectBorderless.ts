/**
 * Borderless-table detection from text coordinates.
 *
 * Idea ("whitespace gutter projection"):
 *  1. Group text items into visual lines (y clustering).
 *  2. Split every line into SEGMENTS wherever the horizontal gap is larger than
 *     `columnGapEm × fontSize` (a word space is ≈0.25em, a column gap is much more).
 *  3. Consecutive lines that contain ≥ 2 segments ("anchor lines") form a BLOCK.
 *     A single single-segment line is tolerated between two anchors (section row).
 *  4. Project all segments of the block on the x axis. x ranges that no segment
 *     (or only a few outliers) covers are GUTTERS; the gutters separate COLUMNS.
 *     Because we use coverage and not start positions this works for left-, right-
 *     and centre-aligned columns alike (numbers are usually right-aligned).
 *  5. Each segment is assigned to the column it overlaps most; single-segment
 *     lines that cross gutters become colSpan cells.
 *  6. Validation (alignment, fill ratio, prose guard) yields a confidence score.
 *     Failing blocks are dropped (auto mode) — "transparency over cleverness":
 *     the user can always draw a region and force extraction.
 */
import { buildLines, median, type TextLine } from "../text";
import { containsPoint } from "../coords";
import type { PageData, RawCell, RawTable, Rect, TextItem } from "../types";

export interface BorderlessOptions {
  columnGapEm: number;
  minRows: number;
  minCols: number;
  /** manual region: skip validation and always return one table (even 1 column) */
  force?: boolean;
  /** rectangles whose text is already owned by a bordered table */
  excluded?: Rect[];
  /** restrict to these items (defaults to page.items) */
  items?: TextItem[];
}

interface Segment {
  items: TextItem[];
  x0: number;
  x1: number;
}

interface LineSegs {
  line: TextLine;
  segs: Segment[];
}

export function splitSegments(line: TextLine, gapEm: number): Segment[] {
  const segs: Segment[] = [];
  const thr = gapEm * line.fontSize;
  for (const it of line.items) {
    const last = segs[segs.length - 1];
    if (last && it.x0 - last.x1 <= thr) {
      last.items.push(it);
      last.x1 = Math.max(last.x1, it.x1);
    } else segs.push({ items: [it], x0: it.x0, x1: it.x1 });
  }
  return segs;
}

/**
 * Find gutters (x ranges with ≤ `tol` covering segments) strictly between the
 * first and last covered x. Returns [start, end] pairs.
 */
export function findGutters(segs: { x0: number; x1: number }[], minWidth: number, tol: number): [number, number][] {
  if (!segs.length) return [];
  const xs = Array.from(new Set(segs.flatMap((s) => [s.x0, s.x1]))).sort((a, b) => a - b);
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const gutters: [number, number][] = [];
  let runStart: number | null = null;
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    const mid = (a + b) / 2;
    const count = segs.reduce((n, s) => n + (s.x0 < mid && s.x1 > mid ? 1 : 0), 0);
    if (count <= tol) {
      if (runStart === null) runStart = a;
    } else if (runStart !== null) {
      // a gutter must start after the first covered x and end before the last one
      if (a - runStart >= minWidth && runStart > minX && a < maxX) gutters.push([runStart, a]);
      runStart = null;
    }
  }
  return gutters;
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function alignmentScore(cellsByCol: Segment[][]): number {
  const scores: number[] = [];
  for (const col of cellsByCol) {
    if (col.length < 2) continue;
    const best = [col.map((s) => s.x0), col.map((s) => s.x1), col.map((s) => (s.x0 + s.x1) / 2)].map((arr) => {
      const m = median(arr);
      return arr.filter((v) => Math.abs(v - m) <= 2.5).length / arr.length;
    });
    scores.push(Math.max(...best));
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

export function detectBorderlessTables(page: PageData, opts: BorderlessOptions): RawTable[] {
  const pool = (opts.items ?? page.items).filter((it) => {
    if (!opts.excluded?.length) return true;
    const cx = (it.x0 + it.x1) / 2;
    const cy = (it.y0 + it.y1) / 2;
    return !opts.excluded.some((r) => containsPoint(r, cx, cy, 1));
  });
  const lines = buildLines(pool);
  const ls: LineSegs[] = lines.map((line) => ({ line, segs: splitSegments(line, opts.columnGapEm) }));

  // --- 1. group lines into blocks ---------------------------------------
  const blocks: LineSegs[][] = [];
  if (opts.force) {
    if (ls.length) blocks.push(ls);
  } else {
    const st: { cur: LineSegs[]; pending: LineSegs | null } = { cur: [], pending: null };
    const flush = () => {
      if (st.cur.length) blocks.push(st.cur);
      st.cur = [];
      st.pending = null;
    };
    for (const l of ls) {
      const prev: LineSegs | undefined = st.pending ?? st.cur[st.cur.length - 1];
      const gap = prev ? l.line.y0 - prev.line.y1 : 0;
      const maxGap = Math.max(l.line.fontSize, prev?.line.fontSize ?? 0) * 1.8;
      if (prev && gap > maxGap) flush();
      if (l.segs.length >= 2) {
        if (st.pending) st.cur.push(st.pending);
        st.pending = null;
        st.cur.push(l);
      } else if (st.cur.length) {
        if (st.pending) flush(); // two single lines in a row → the block ended before them
        else st.pending = l;
      }
    }
    flush();
  }

  const tables: RawTable[] = [];
  for (const block of blocks) {
    const anchors = block.filter((l) => l.segs.length >= 2);
    if (!opts.force && anchors.length < opts.minRows) continue;
    if (opts.force && !block.length) continue;

    // --- 2. columns via gutters ---------------------------------------------
    const fontSize = median(block.map((l) => l.line.fontSize)) || 10;
    const basis = anchors.length >= 4 ? anchors.slice(1) : anchors; // header may bridge columns
    const segPool = basis.flatMap((l) => l.segs);
    const tol = basis.length >= 12 ? Math.floor(basis.length * 0.08) : 0;
    const gutters = findGutters(segPool, Math.max(3, fontSize * 0.35), tol);

    const allSegs = block.flatMap((l) => l.segs);
    const minX = Math.min(...allSegs.map((s) => s.x0));
    const maxX = Math.max(...allSegs.map((s) => s.x1));
    const colEdges = [minX - 1, ...gutters.map(([a, b]) => (a + b) / 2), maxX + 1];
    const nCols = colEdges.length - 1;
    if (!opts.force && nCols < opts.minCols) continue;

    // --- 3. assign segments to cells -------------------------------------
    const rowEdges: number[] = [];
    block.forEach((l, i) => {
      if (i === 0) rowEdges.push(l.line.y0 - 1);
      else rowEdges.push((block[i - 1].line.y1 + l.line.y0) / 2);
    });
    rowEdges.push(block[block.length - 1].line.y1 + 1);

    const cellMap = new Map<string, RawCell>();
    const cellOf = (r: number, c: number): RawCell => {
      const k = `${r}:${c}`;
      let cell = cellMap.get(k);
      if (!cell) {
        cell = { row: r, col: c, rowSpan: 1, colSpan: 1, rect: { x0: colEdges[c], y0: rowEdges[r], x1: colEdges[c + 1], y1: rowEdges[r + 1] }, items: [], suspect: [] };
        cellMap.set(k, cell);
      }
      return cell;
    };
    const byCol: Segment[][] = Array.from({ length: nCols }, () => []);
    const covered = new Set<string>();

    block.forEach((l, r) => {
      for (const seg of l.segs) {
        const ov = Array.from({ length: nCols }, (_, c) => overlapLen(seg.x0, seg.x1, colEdges[c], colEdges[c + 1]));
        const touched = ov.map((v, c) => (v > 2 ? c : -1)).filter((c) => c >= 0);
        const best = ov.indexOf(Math.max(...ov));
        if (l.segs.length === 1 && touched.length >= 2) {
          // spanning cell (title / section row crossing columns)
          const c0 = touched[0];
          const c1 = touched[touched.length - 1];
          const cell = cellOf(r, c0);
          cell.colSpan = c1 - c0 + 1;
          cell.rect = { ...cell.rect, x1: colEdges[c1 + 1] };
          cell.items.push(...seg.items);
          for (let c = c0 + 1; c <= c1; c++) covered.add(`${r}:${c}`);
        } else {
          const cell = cellOf(r, best);
          if (cell.items.length) cell.suspect.push("reason.multipleInCell");
          if (touched.length >= 2) cell.suspect.push("reason.spansColumns");
          cell.items.push(...seg.items);
          byCol[best].push(seg);
        }
      }
    });

    // --- 4. validation / confidence -----------------------------------------
    const filled = new Set<string>();
    cellMap.forEach((c, k) => {
      if (c.items.length) filled.add(k);
    });
    const fill = filled.size / (block.length * nCols);
    const avgChars = allSegs.reduce((n, s) => n + s.items.reduce((m, i) => m + i.str.length, 0), 0) / allSegs.length;
    const align = alignmentScore(byCol);
    if (!opts.force) {
      if (fill < 0.5) continue;
      if (avgChars > 45) continue; // two-column prose, not a table
      if (align < 0.4) continue;
    }

    // materialise all owner cells (including empty ones)
    const cells: RawCell[] = [];
    for (let r = 0; r < block.length; r++) {
      for (let c = 0; c < nCols; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        cells.push(cellOf(r, c));
      }
    }

    const confidence = Math.min(0.85, 0.5 + 0.25 * align + 0.12 * fill + (anchors.length >= 5 ? 0.04 : 0)) - (cells.some((c) => c.suspect.length) ? 0.05 : 0);
    tables.push({
      source: opts.force ? "manual" : "borderless",
      page: page.pageNumber,
      bbox: { x0: minX, y0: block[0].line.y0, x1: maxX, y1: block[block.length - 1].line.y1 },
      nRows: block.length,
      nCols,
      rowEdges,
      colEdges,
      cells,
      confidence: opts.force ? Math.min(confidence, 0.7) : confidence,
      notes: [],
    });
  }
  return tables;
}
