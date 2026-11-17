/**
 * Bordered-table detection from drawn rule lines.
 *
 * Pipeline
 *  1. Merge collinear/overlapping line fragments (generators often draw one
 *     border as many short segments).
 *  2. Group horizontal + vertical lines that touch each other into connected
 *     components (union-find). Each component is a table candidate.
 *  3. The distinct x positions of vertical lines / y positions of horizontal
 *     lines form the column / row edges (clustered with a small tolerance).
 *  4. Merged cells: for every pair of neighbouring grid cells check how much of
 *     the shared edge is actually covered by a drawn line. Uncovered edge ⇒ the
 *     cells are one merged cell (rowSpan / colSpan).
 *  5. Text items are assigned to cells by the position of their CENTRE point.
 */
import { intersection, rectArea } from "../coords";
import type { PageData, RawCell, RawTable, Rect, RuleLine, TextItem } from "../types";

const EDGE_TOL = 3; // pt – lines closer than this belong to the same grid edge
const TOUCH_TOL = 2.5; // pt – h/v lines closer than this are "connected"
const COVER_RATIO = 0.6; // fraction of an edge that must be drawn to count as a border
const MIN_LINE = 6;

/** Merge collinear overlapping fragments of one orientation. */
export function mergeCollinear(lines: RuleLine[], orientation: "h" | "v"): RuleLine[] {
  const key = (l: RuleLine) => (orientation === "h" ? l.y0 : l.x0);
  const start = (l: RuleLine) => (orientation === "h" ? l.x0 : l.y0);
  const end = (l: RuleLine) => (orientation === "h" ? l.x1 : l.y1);
  const sorted = lines.filter((l) => l.orientation === orientation).sort((a, b) => key(a) - key(b) || start(a) - start(b));

  const clusters: RuleLine[][] = [];
  for (const l of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(key(last[0]) - key(l)) <= 1.5) last.push(l);
    else clusters.push([l]);
  }
  const out: RuleLine[] = [];
  for (const c of clusters) {
    const coord = c.reduce((s, l) => s + key(l), 0) / c.length;
    const thick = Math.max(...c.map((l) => l.thickness));
    c.sort((a, b) => start(a) - start(b));
    let s = start(c[0]);
    let e = end(c[0]);
    const push = () => {
      if (e - s < MIN_LINE) return;
      out.push(
        orientation === "h"
          ? { orientation, x0: s, x1: e, y0: coord, y1: coord, thickness: thick }
          : { orientation, y0: s, y1: e, x0: coord, x1: coord, thickness: thick },
      );
    };
    for (let i = 1; i < c.length; i++) {
      if (start(c[i]) <= e + 2.5) e = Math.max(e, end(c[i]));
      else {
        push();
        s = start(c[i]);
        e = end(c[i]);
      }
    }
    push();
  }
  return out;
}

/** Cluster sorted numbers within tolerance and return cluster means. */
export function clusterValues(values: number[], tol = EDGE_TOL): number[] {
  const s = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of s) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** Fraction of segment [a,b] on the line axis that is covered by lines located at `coord`. */
function edgeCoverage(lines: RuleLine[], orientation: "h" | "v", coord: number, a: number, b: number): number {
  let covered = 0;
  for (const l of lines) {
    const pos = orientation === "h" ? l.y0 : l.x0;
    if (Math.abs(pos - coord) > EDGE_TOL) continue;
    const s = orientation === "h" ? l.x0 : l.y0;
    const e = orientation === "h" ? l.x1 : l.y1;
    const ov = Math.min(b, e) - Math.max(a, s);
    if (ov > 0) covered += ov;
  }
  return b - a > 0 ? Math.min(1, covered / (b - a)) : 0;
}

const indexOfBand = (edges: number[], v: number): number => {
  for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i] && v < edges[i + 1]) return i;
  return v === edges[edges.length - 1] ? edges.length - 2 : -1;
};

export interface BorderedOptions {
  /** text items to assign; defaults to all page items */
  items?: TextItem[];
}

export function detectBorderedTables(page: PageData, opts: BorderedOptions = {}): RawTable[] {
  const items = opts.items ?? page.items;
  const H = mergeCollinear(page.rules, "h");
  const V = mergeCollinear(page.rules, "v");
  if (H.length < 2 || V.length < 2) return [];

  // --- connected components -------------------------------------------------
  const all = [...H, ...V];
  const uf = new UnionFind(all.length);
  for (let i = 0; i < H.length; i++) {
    for (let j = 0; j < V.length; j++) {
      const h = H[i];
      const v = V[j];
      if (v.x0 >= h.x0 - TOUCH_TOL && v.x0 <= h.x1 + TOUCH_TOL && h.y0 >= v.y0 - TOUCH_TOL && h.y0 <= v.y1 + TOUCH_TOL) {
        uf.union(i, H.length + j);
      }
    }
  }
  const comps = new Map<number, RuleLine[]>();
  all.forEach((l, i) => {
    const r = uf.find(i);
    (comps.get(r) ?? comps.set(r, []).get(r)!).push(l);
  });

  const tables: RawTable[] = [];
  for (const lines of comps.values()) {
    const hs = lines.filter((l) => l.orientation === "h");
    const vs = lines.filter((l) => l.orientation === "v");
    if (hs.length < 2 || vs.length < 2) continue;

    let colEdges = clusterValues(vs.map((l) => l.x0));
    let rowEdges = clusterValues(hs.map((l) => l.y0));

    // Open outer borders: horizontal lines that extend past the outermost vertical line
    // (or vice-versa) still define the table's extent.
    const hMin = Math.min(...hs.map((l) => l.x0));
    const hMax = Math.max(...hs.map((l) => l.x1));
    const vMin = Math.min(...vs.map((l) => l.y0));
    const vMax = Math.max(...vs.map((l) => l.y1));
    if (hMin < colEdges[0] - EDGE_TOL) colEdges = [hMin, ...colEdges];
    if (hMax > colEdges[colEdges.length - 1] + EDGE_TOL) colEdges = [...colEdges, hMax];
    if (vMin < rowEdges[0] - EDGE_TOL) rowEdges = [vMin, ...rowEdges];
    if (vMax > rowEdges[rowEdges.length - 1] + EDGE_TOL) rowEdges = [...rowEdges, vMax];

    const nCols = colEdges.length - 1;
    const nRows = rowEdges.length - 1;
    if (nCols < 2 || nRows < 2) continue;

    // --- merged cells: walk the grid and extend over uncovered inner edges ---
    const owner: number[][] = Array.from({ length: nRows }, () => Array(nCols).fill(-1));
    const cells: RawCell[] = [];
    const vCovered = (c: number, r: number) => edgeCoverage(vs, "v", colEdges[c], rowEdges[r], rowEdges[r + 1]) >= COVER_RATIO;
    const hCovered = (r: number, c: number) => edgeCoverage(hs, "h", rowEdges[r], colEdges[c], colEdges[c + 1]) >= COVER_RATIO;
    let mergedCount = 0;

    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        if (owner[r][c] !== -1) continue;
        let cs = 1;
        while (c + cs < nCols && owner[r][c + cs] === -1 && !vCovered(c + cs, r)) cs++;
        let rs = 1;
        outer: while (r + rs < nRows) {
          for (let cc = c; cc < c + cs; cc++) {
            if (owner[r + rs][cc] !== -1 || hCovered(r + rs, cc)) break outer;
          }
          rs++;
        }
        const idx = cells.length;
        for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) owner[rr][cc] = idx;
        if (cs > 1 || rs > 1) mergedCount++;
        cells.push({
          row: r,
          col: c,
          rowSpan: rs,
          colSpan: cs,
          rect: { x0: colEdges[c], y0: rowEdges[r], x1: colEdges[c + cs], y1: rowEdges[r + rs] },
          items: [],
          suspect: [],
        });
      }
    }

    // --- assign text by centre point --------------------------------------
    const bbox: Rect = { x0: colEdges[0], y0: rowEdges[0], x1: colEdges[nCols], y1: rowEdges[nRows] };
    let textCount = 0;
    for (const it of items) {
      const cx = (it.x0 + it.x1) / 2;
      const cy = (it.y0 + it.y1) / 2;
      const c = indexOfBand(colEdges, cx);
      const r = indexOfBand(rowEdges, cy);
      if (c < 0 || r < 0) continue;
      const cell = cells[owner[r][c]];
      cell.items.push(it);
      textCount++;
      // text poking more than 35% of its width into a neighbouring cell → uncertain
      const w = it.x1 - it.x0;
      const outside = Math.max(0, cell.rect.x0 - it.x0) + Math.max(0, it.x1 - cell.rect.x1);
      if (w > 0 && outside / w > 0.35 && !cell.suspect.includes("reason.crossesBorder")) cell.suspect.push("reason.crossesBorder");
    }
    if (textCount === 0) continue;
    if (rectArea(bbox) < 400) continue;

    // --- confidence --------------------------------------------------------
    const empty = cells.filter((c) => c.items.length === 0).length / cells.length;
    let confidence = 0.93;
    confidence -= Math.min(0.15, mergedCount * 0.03);
    confidence -= cells.some((c) => c.suspect.length) ? 0.08 : 0;
    confidence -= empty > 0.5 ? 0.1 : 0;
    const notes = mergedCount > 0 ? [`merged:${mergedCount}`] : [];

    tables.push({ source: "bordered", page: page.pageNumber, bbox, nRows, nCols, rowEdges, colEdges, cells, confidence, notes });
  }

  // drop tables fully contained in a bigger one (nested decorative frames)
  return tables
    .filter((t, i) => !tables.some((o, j) => j !== i && rectArea(o.bbox) > rectArea(t.bbox) && (intersection(o.bbox, t.bbox) ? rectArea(intersection(o.bbox, t.bbox)!) / rectArea(t.bbox) > 0.95 : false)))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
}
