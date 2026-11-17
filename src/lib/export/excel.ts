/**
 * Excel (.xlsx) generation with SheetJS.
 *
 * - Cell values are typed: numbers/currency/percent/dates are written as real Excel
 *   numbers with a number format (`z`) so Excel can calculate with them. Negative numbers,
 *   parenthesised accounting negatives, currency symbols and percentages are preserved.
 * - Anything that does not parse for its column type stays text (never silently dropped).
 * - Dates are written as Excel serial numbers + yyyy-mm-dd format (timezone independent).
 * - Merged cells detected in bordered tables are exported as sheet merges.
 */
import * as XLSX from "xlsx";
import { displayWidth } from "../text";
import { cellIssues, effectiveType, exportsHeader } from "../tables/tableModel";
import type { ExcelSettings, ExtractedTable } from "../types";
import { matchesType, parseValue } from "../valueParse";

type DateOrder = "auto" | "MDY" | "DMY";

export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, "_").replace(/^'+|'+$/g, "").trim() || "Sheet";
  base = base.slice(0, 31);
  let out = base;
  let i = 2;
  while (used.has(out.toLowerCase())) {
    const suffix = `_${i++}`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(out.toLowerCase());
  return out;
}

/** Convert a text value to a SheetJS cell according to the column type. */
export function toSheetCell(
  value: string,
  type: ReturnType<typeof effectiveType>,
  applyFormats: boolean,
  dateOrder: DateOrder,
  columnCurrencyFormat?: string,
): XLSX.CellObject | null {
  const text = value ?? "";
  if (!text.trim()) return null;
  if (!applyFormats || type === "text") return { t: "s", v: text };
  const p = parseValue(text, { dateOrder });
  if (p.kind === "text" || p.kind === "empty" || p.value === undefined || !matchesType(p, type)) return { t: "s", v: text };

  if (type === "percent" && p.kind === "number") {
    // "12.5" in a column the user marked as percent → 12.5 %
    const decimals = (text.split(/[.,]/)[1] ?? "").length;
    return { t: "n", v: p.value / 100, z: decimals > 0 ? `0.${"0".repeat(decimals)}%` : "0%" };
  }
  if (type === "currency" && p.kind === "number" && columnCurrencyFormat) {
    return { t: "n", v: p.value, z: columnCurrencyFormat };
  }
  return { t: "n", v: p.value, z: p.format };
}

function dominantCurrencyFormat(table: ExtractedTable, col: number, dateOrder: DateOrder): string | undefined {
  const counts = new Map<string, number>();
  for (const r of table.rows) {
    const p = parseValue(r.cells[col]?.value ?? "", { dateOrder });
    if (p.kind === "currency" && p.format) counts.set(p.format, (counts.get(p.format) ?? 0) + 1);
  }
  let best: string | undefined;
  let n = 0;
  counts.forEach((v, k) => {
    if (v > n) {
      n = v;
      best = k;
    }
  });
  return best;
}

interface Placed {
  ws: XLSX.WorkSheet;
  nextRow: number;
  widths: number[];
  merges: XLSX.Range[];
}

/** Write one table into a sheet starting at row `startRow`; returns the next free row. */
function writeTable(p: Placed, table: ExtractedTable, settings: ExcelSettings, dateOrder: DateOrder, startRow: number, title: boolean): void {
  let r = startRow;
  const set = (row: number, col: number, cell: XLSX.CellObject | null) => {
    if (!cell) return;
    p.ws[XLSX.utils.encode_cell({ r: row, c: col })] = cell;
    const w = displayWidth(String(cell.t === "n" ? (cell.w ?? cell.v) : (cell.v ?? "")));
    p.widths[col] = Math.max(p.widths[col] ?? 8, Math.min(60, w + 2));
  };
  if (title) {
    set(r, 0, { t: "s", v: table.name });
    r += 1;
  }
  if (settings.includeHeader && table.columns.length && exportsHeader(table)) {
    table.columns.forEach((c, i) => set(r, i, { t: "s", v: c.name }));
    r += 1;
  }
  const types = table.columns.map((_, i) => effectiveType(table, i, dateOrder));
  const curFmt = table.columns.map((_, i) => (types[i] === "currency" ? dominantCurrencyFormat(table, i, dateOrder) : undefined));
  table.rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      if (cell.covered) return;
      const sc = toSheetCell(cell.value, types[ci], settings.applyFormats, dateOrder, curFmt[ci]);
      if (sc && settings.reviewComments && cellIssues(cell, types[ci], dateOrder).length) {
        // Excel cell comment so uncertain values are visible after export as well
        sc.c = [{ a: "PDF Converter Toolkit", t: `Needs review — extracted value: "${cell.original}"` }];
        sc.c.hidden = true;
      }
      set(r + ri, ci, sc);
      if (cell.rowSpan > 1 || cell.colSpan > 1) {
        p.merges.push({ s: { r: r + ri, c: ci }, e: { r: r + ri + Math.min(cell.rowSpan, table.rows.length - ri) - 1, c: ci + cell.colSpan - 1 } });
      }
    });
  });
  p.nextRow = r + table.rows.length;
}

function finalize(p: Placed, maxCol: number) {
  p.ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, p.nextRow - 1), c: Math.max(0, maxCol - 1) } });
  p.ws["!cols"] = Array.from({ length: maxCol }, (_, i) => ({ wch: p.widths[i] ?? 10 }));
  if (p.merges.length) p.ws["!merges"] = p.merges;
}

export function buildWorkbook(tables: ExtractedTable[], settings: ExcelSettings, dateOrder: DateOrder = "auto"): XLSX.WorkBook {
  const list = tables.filter((t) => t.included && (t.columns.length > 0 || t.rows.length > 0));
  if (!list.length) throw new Error("No tables selected for export.");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  if (settings.layout === "combined") {
    const p: Placed = { ws: {}, nextRow: 0, widths: [], merges: [] };
    let maxCol = 1;
    let row = 0;
    list.forEach((t, i) => {
      if (i > 0) row = p.nextRow + 1; // blank separator row
      writeTable(p, t, settings, dateOrder, row, settings.tableTitles);
      maxCol = Math.max(maxCol, t.columns.length);
    });
    finalize(p, maxCol);
    XLSX.utils.book_append_sheet(wb, p.ws, sanitizeSheetName("Combined", used));
  } else {
    for (const t of list) {
      const p: Placed = { ws: {}, nextRow: 0, widths: [], merges: [] };
      writeTable(p, t, settings, dateOrder, 0, false);
      finalize(p, t.columns.length);
      XLSX.utils.book_append_sheet(wb, p.ws, sanitizeSheetName(t.name, used));
    }
  }
  return wb;
}

export function workbookToBytes(wb: XLSX.WorkBook): Uint8Array {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}
