/**
 * Pure operations on the editable table model (immutable updates).
 * Everything the TableEditor UI does goes through these functions so they can be unit-tested.
 */
import { uid } from "../text";
import type { Cell, Column, ColumnType, ExtractedTable, Row } from "../types";
import { inferColumnType, matchesType, parseValue, type ParsedValue } from "../valueParse";

type EffType = Exclude<ColumnType, "auto">;

/** Effective type of a column: the user's choice, or the inferred one for "auto". */
export function effectiveType(table: ExtractedTable, colIndex: number, dateOrder: "auto" | "MDY" | "DMY" = "auto"): EffType {
  const col = table.columns[colIndex];
  if (!col) return "text";
  if (col.type !== "auto") return col.type;
  const values = table.rows.filter((r) => !r.cells[colIndex]?.covered).map((r) => r.cells[colIndex]?.value ?? "");
  return inferColumnType(values, dateOrder);
}

export interface CellIssue {
  /** i18n key (reason.*) */
  reason: string;
}

/** Why a cell needs review (empty list = fine). Corrected/confirmed cells never need review. */
export function cellIssues(cell: Cell, type: EffType, dateOrder: "auto" | "MDY" | "DMY" = "auto"): CellIssue[] {
  if (cell.status === "confirmed" || cell.covered) return [];
  const out: CellIssue[] = cell.suspect.map((reason) => ({ reason }));
  const parsed: ParsedValue = parseValue(cell.value, { dateOrder });
  if (!matchesType(parsed, type)) out.push({ reason: `reason.notType.${type}` });
  if (parsed.kind === "date" && parsed.ambiguous) out.push({ reason: "reason.ambiguousDate" });
  return out;
}

export interface TableStats {
  cells: number;
  needsReview: number;
  confirmed: number;
  corrected: number;
}

export function tableStats(table: ExtractedTable, dateOrder: "auto" | "MDY" | "DMY" = "auto"): TableStats {
  const types = table.columns.map((_, i) => effectiveType(table, i, dateOrder));
  let cells = 0;
  let needsReview = 0;
  let confirmed = 0;
  let corrected = 0;
  for (const r of table.rows) {
    r.cells.forEach((c, i) => {
      if (c.covered) return;
      cells++;
      if (c.status === "confirmed") confirmed++;
      if (c.value !== c.original) corrected++;
      if (cellIssues(c, types[i] ?? "text", dateOrder).length) needsReview++;
    });
  }
  return { cells, needsReview, confirmed, corrected };
}

/**
 * Extraction confidence (0..1):
 *   geometric confidence of the detector × (1 − 0.6·share of cells needing review),
 *   floored; user-confirmed cells count as certain, which raises the score.
 */
export function tableConfidence(table: ExtractedTable, dateOrder: "auto" | "MDY" | "DMY" = "auto"): number {
  const s = tableStats(table, dateOrder);
  if (!s.cells) return table.baseConfidence;
  const reviewShare = s.needsReview / s.cells;
  return Math.max(0.05, Math.min(1, table.baseConfidence * (1 - 0.6 * reviewShare)));
}

export type ConfidenceLevel = "high" | "medium" | "low";
export const confidenceLevel = (c: number): ConfidenceLevel => (c >= 0.8 ? "high" : c >= 0.55 ? "medium" : "low");

/* ---------------------------- editing operations ---------------------------- */

const mapTable = (t: ExtractedTable, fn: (t: ExtractedTable) => Partial<ExtractedTable>): ExtractedTable => ({ ...t, ...fn(t) });

/** Edit a cell. The original value is kept; any edit marks the cell as "User confirmed". */
export function setCellValue(t: ExtractedTable, rowId: string, colIndex: number, value: string): ExtractedTable {
  return mapTable(t, (tb) => ({
    rows: tb.rows.map((r) =>
      r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => (i === colIndex ? { ...c, value, status: "confirmed" as const } : c)) },
    ),
  }));
}

export function confirmCell(t: ExtractedTable, rowId: string, colIndex: number): ExtractedTable {
  return mapTable(t, (tb) => ({
    rows: tb.rows.map((r) =>
      r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => (i === colIndex ? { ...c, status: "confirmed" as const } : c)) },
    ),
  }));
}

export function confirmAll(t: ExtractedTable): ExtractedTable {
  return mapTable(t, (tb) => ({
    rows: tb.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, status: "confirmed" as const })) })),
    columns: tb.columns.map((c) => ({ ...c, nameStatus: "confirmed" as const })),
  }));
}

export function revertCell(t: ExtractedTable, rowId: string, colIndex: number): ExtractedTable {
  return mapTable(t, (tb) => ({
    rows: tb.rows.map((r) =>
      r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => (i === colIndex ? { ...c, value: c.original, status: "auto" as const } : c)) },
    ),
  }));
}

export function renameColumn(t: ExtractedTable, colIndex: number, name: string): ExtractedTable {
  return mapTable(t, (tb) => ({
    columns: tb.columns.map((c, i) => (i === colIndex ? { ...c, name, nameStatus: "confirmed" as const } : c)),
  }));
}

export function setColumnType(t: ExtractedTable, colIndex: number, type: ColumnType): ExtractedTable {
  return mapTable(t, (tb) => ({ columns: tb.columns.map((c, i) => (i === colIndex ? { ...c, type } : c)) }));
}

/** Remove any merged-cell spans touching the given row (so the grid stays consistent after deletes). */
function unmergeAll(rows: Row[]): Row[] {
  return rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, rowSpan: 1, colSpan: 1, covered: false })) }));
}

export function deleteRow(t: ExtractedTable, rowId: string): ExtractedTable {
  const hasSpans = t.rows.some((r) => r.cells.some((c) => c.rowSpan > 1 || c.colSpan > 1 || c.covered));
  const rows = t.rows.filter((r) => r.id !== rowId);
  return { ...t, rows: hasSpans ? unmergeAll(rows) : rows };
}

export function deleteColumn(t: ExtractedTable, colIndex: number): ExtractedTable {
  if (t.columns.length <= 1) return t;
  const hasSpans = t.rows.some((r) => r.cells.some((c) => c.rowSpan > 1 || c.colSpan > 1 || c.covered));
  const rows = t.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== colIndex) }));
  return {
    ...t,
    columns: t.columns.filter((_, i) => i !== colIndex),
    rows: hasSpans ? unmergeAll(rows) : rows,
    colEdges: t.colEdges.filter((_, i) => i !== colIndex),
  };
}

const emptyCell = (page: number): Cell => ({
  id: uid("c"),
  original: "",
  value: "",
  status: "auto",
  suspect: [],
  rowSpan: 1,
  colSpan: 1,
  covered: false,
  page,
});

export function addRow(t: ExtractedTable, afterRowId?: string): ExtractedTable {
  const page = t.regions[0]?.page ?? 1;
  const row: Row = { id: uid("r"), page, cells: t.columns.map(() => emptyCell(page)) };
  const idx = afterRowId ? t.rows.findIndex((r) => r.id === afterRowId) + 1 : t.rows.length;
  const rows = [...t.rows.slice(0, idx), row, ...t.rows.slice(idx)];
  return { ...t, rows };
}

export function addColumn(t: ExtractedTable): ExtractedTable {
  const name = `Column ${t.columns.length + 1}`;
  const col: Column = { id: uid("col"), name, originalName: name, nameStatus: "auto", type: "auto" };
  return {
    ...t,
    columns: [...t.columns, col],
    rows: t.rows.map((r) => ({ ...r, cells: [...r.cells, emptyCell(r.page)] })),
  };
}

/** Join a row into the row above it (fixes wrapped multi-line cells). */
export function mergeRowIntoPrevious(t: ExtractedTable, rowId: string): ExtractedTable {
  const idx = t.rows.findIndex((r) => r.id === rowId);
  if (idx <= 0) return t;
  const prev = t.rows[idx - 1];
  const cur = t.rows[idx];
  const cells = prev.cells.map((c, i) => {
    const add = cur.cells[i]?.value.trim();
    if (!add) return c;
    const v = c.value ? `${c.value} ${add}` : add;
    return { ...c, value: v, original: c.original, status: "confirmed" as const };
  });
  const rows = [...t.rows];
  rows.splice(idx - 1, 2, { ...prev, cells });
  return { ...t, rows };
}

/** Toggle whether the first row is the header: moves text between column names and the first body row. */
export function setHasHeader(t: ExtractedTable, hasHeader: boolean): ExtractedTable {
  if (t.hasHeader === hasHeader) return t;
  const page = t.regions[0]?.page ?? 1;
  if (hasHeader) {
    const first = t.rows[0];
    if (!first) return { ...t, hasHeader };
    return {
      ...t,
      hasHeader,
      columns: t.columns.map((c, i) => {
        const v = first.cells[i]?.value.trim();
        return v ? { ...c, name: v, originalName: v, nameStatus: "auto" as const } : c;
      }),
      rows: t.rows.slice(1),
    };
  }
  const headerRow: Row = {
    id: uid("r"),
    page,
    cells: t.columns.map((c) => ({ ...emptyCell(page), original: c.name, value: c.name })),
  };
  return { ...t, hasHeader, rows: [headerRow, ...t.rows] };
}

/** Set a column's values from an ordered list (used by "assign region to Excel column"). */
export function assignColumnValues(t: ExtractedTable, colIndex: number, values: { value: string; y?: number; page?: number }[]): ExtractedTable {
  const rows = [...t.rows];
  const used = new Set<number>();
  const leftovers: string[] = [];
  const hasY = values.every((v) => v.y !== undefined && v.page !== undefined);

  values.forEach((v, vi) => {
    let target = -1;
    if (hasY) {
      target = rows.findIndex(
        (r, ri) => !used.has(ri) && r.page === v.page && r.rect && v.y! >= r.rect.y0 - 1 && v.y! <= r.rect.y1 + 1,
      );
    } else if (vi < rows.length) target = vi;
    if (target >= 0) {
      used.add(target);
      rows[target] = {
        ...rows[target],
        cells: rows[target].cells.map((c, i) => (i === colIndex ? { ...c, value: v.value, status: "confirmed" as const } : c)),
      };
    } else leftovers.push(v.value);
  });
  const page = t.regions[0]?.page ?? 1;
  for (const v of leftovers) {
    rows.push({
      id: uid("r"),
      page,
      cells: t.columns.map((_, i) => (i === colIndex ? { ...emptyCell(page), original: "", value: v, status: "confirmed" as const } : emptyCell(page))),
    });
  }
  return { ...t, rows };
}

/* ------------------------------- merging ------------------------------- */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Merge `b` (continuation) into `a`. A repeated header at the top of `b` is dropped;
 * a different header in `b` is demoted to a normal data row so nothing is lost.
 * Tables with different column counts are padded and flagged in `notes`.
 */
export function mergeTables(a: ExtractedTable, b: ExtractedTable): ExtractedTable {
  const nCols = Math.max(a.columns.length, b.columns.length);
  const pad = (rows: Row[], from: number): Row[] =>
    rows.map((r) => ({ ...r, cells: [...r.cells, ...Array.from({ length: nCols - from }, () => emptyCell(r.page))] }));

  let bRows = b.rows;
  if (b.hasHeader) {
    const same = b.columns.length === a.columns.length && b.columns.every((c, i) => norm(c.name) === norm(a.columns[i].name));
    if (!same) {
      const page = b.regions[0]?.page ?? 1;
      bRows = [
        { id: uid("r"), page, cells: b.columns.map((c) => ({ ...emptyCell(page), original: c.name, value: c.name })) },
        ...bRows,
      ];
    }
  }
  const columns = [...a.columns];
  while (columns.length < nCols) {
    const name = `Column ${columns.length + 1}`;
    columns.push({ id: uid("col"), name, originalName: name, nameStatus: "auto", type: "auto" });
  }
  const notes = [...a.notes, ...b.notes.filter((n) => !a.notes.includes(n))];
  if (a.columns.length !== b.columns.length) notes.push("note.columnMismatch");
  return {
    ...a,
    columns,
    rows: [...pad(a.rows, a.columns.length), ...pad(bRows, b.columns.length)],
    regions: [...a.regions, ...b.regions],
    baseConfidence: Math.min(a.baseConfidence, b.baseConfidence) - (a.columns.length !== b.columns.length ? 0.1 : 0),
    notes,
  };
}

/** Should the header row be exported? Only when the table has a real header or the user named columns. */
export const exportsHeader = (t: ExtractedTable): boolean => t.hasHeader || t.columns.some((c) => c.nameStatus === "confirmed");

/** Pages covered by the table, sorted. */
export const tablePages = (t: ExtractedTable): number[] => [...new Set(t.regions.map((r) => r.page))].sort((x, y) => x - y);
