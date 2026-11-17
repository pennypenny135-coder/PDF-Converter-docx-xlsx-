/**
 * Shared domain types.
 *
 * COORDINATE SYSTEM (important — read once, applies everywhere in /lib):
 *   Every geometric value that leaves the PDF extraction layer is expressed in
 *   "page points" with a TOP-LEFT origin: x grows to the right, y grows DOWN,
 *   1 unit = 1/72 inch at 100% scale (identical to PDF.js viewport scale = 1).
 *   Raw PDF user space has a BOTTOM-LEFT origin (y grows up); the conversion is
 *   done exactly once, in lib/coords.ts + lib/pdf/extractPage.ts.
 */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One text run as reported by PDF.js, converted to top-left page points. */
export interface TextItem extends Rect {
  id: string;
  str: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontName: string;
}

/** An axis-aligned drawn line (from stroked paths, rect edges or thin filled rects). */
export interface RuleLine extends Rect {
  orientation: "h" | "v";
  thickness: number;
}

/** Everything the converters need to know about one page. JSON-serialisable (used by fixtures). */
export interface PageData {
  pageNumber: number; // 1-based
  width: number;
  height: number;
  items: TextItem[];
  rules: RuleLine[];
  images: Rect[];
  charCount: number;
  /** true when the page has (almost) no selectable text but does contain images */
  looksScanned: boolean;
}

/* ------------------------------------------------------------------ */
/* Table detection output (before it becomes an editable model)        */
/* ------------------------------------------------------------------ */

export type TableSource = "bordered" | "borderless" | "manual";

export interface RawCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rect: Rect;
  items: TextItem[];
  /** Reasons the cell is uncertain (i18n keys under "reason.*"). */
  suspect: string[];
}

export interface RawTable {
  source: TableSource;
  page: number;
  bbox: Rect;
  nRows: number;
  nCols: number;
  rowEdges: number[]; // nRows + 1 y positions
  colEdges: number[]; // nCols + 1 x positions
  cells: RawCell[];
  /** 0..1 geometric confidence before text-level checks */
  confidence: number;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Editable model                                                      */
/* ------------------------------------------------------------------ */

export type ColumnType = "auto" | "text" | "number" | "currency" | "percent" | "date";
export type CellStatus = "auto" | "confirmed";

export interface Cell {
  id: string;
  /** Value exactly as extracted. Never overwritten. */
  original: string;
  /** Current value (equals `original` until the user edits it). */
  value: string;
  status: CellStatus;
  suspect: string[];
  rowSpan: number;
  colSpan: number;
  covered: boolean; // hidden because another cell spans over it
  rect?: Rect;
  page: number;
}

export interface Row {
  id: string;
  page: number;
  rect?: Rect;
  cells: Cell[];
}

export interface Column {
  id: string;
  name: string;
  originalName: string;
  nameStatus: CellStatus;
  type: ColumnType;
  rect?: Rect;
  page?: number;
}

export interface TableRegion {
  page: number;
  rect: Rect;
}

export interface ExtractedTable {
  id: string;
  name: string;
  source: TableSource;
  regions: TableRegion[];
  columns: Column[];
  rows: Row[];
  hasHeader: boolean;
  baseConfidence: number;
  included: boolean;
  notes: string[];
  /** column x-edges of the first fragment, used to match continuation tables */
  colEdges: number[];
}

export type BlockKind = "heading" | "paragraph" | "list-bullet" | "list-number";

export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface TextBlock {
  id: string;
  page: number;
  kind: BlockKind;
  level: 1 | 2 | 3; // heading level (ignored for other kinds)
  original: string;
  text: string;
  /** styled runs; dropped once the user edits the text */
  runs?: TextRun[];
  fontSize: number;
  bold: boolean;
  italic: boolean;
  rect: Rect;
  status: CellStatus;
  included: boolean;
  manual: boolean;
}

export interface ImageBlock {
  id: string;
  page: number;
  rect: Rect;
  included: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface DetectionSettings {
  detectBordered: boolean;
  detectBorderless: boolean;
  /** minimum horizontal gap (in em) that separates two columns in borderless tables */
  columnGapEm: number;
  minRows: number;
  dateOrder: "auto" | "MDY" | "DMY";
  autoMergeContinued: boolean;
  extractText: boolean;
  extractImages: boolean;
}

export const DEFAULT_DETECTION: DetectionSettings = {
  detectBordered: true,
  detectBorderless: true,
  columnGapEm: 0.9,
  minRows: 3,
  dateOrder: "auto",
  autoMergeContinued: false,
  extractText: true,
  extractImages: true,
};

export interface ExcelSettings {
  layout: "separate" | "combined";
  includeHeader: boolean;
  tableTitles: boolean;
  applyFormats: boolean;
  /** add a "Needs review" comment to cells that are still uncertain */
  reviewComments: boolean;
}

export interface WordSettings {
  mode: "editable" | "layout";
  includeImages: boolean;
  pageSize: "source" | "a4" | "letter";
}

export const DEFAULT_EXCEL: ExcelSettings = {
  layout: "separate",
  includeHeader: true,
  tableTitles: true,
  applyFormats: true,
  reviewComments: true,
};

export const DEFAULT_WORD: WordSettings = {
  mode: "editable",
  includeImages: true,
  pageSize: "source",
};

export type RegionTarget =
  | { type: "table" }
  | { type: "paragraph" }
  | { type: "heading"; level: 1 | 2 | 3 }
  | { type: "column"; tableId: string; columnIndex: number };
