import { describe, expect, it } from "vitest";
import { analyzePage } from "../analyze";
import { suggestContinuations } from "../tables/continuation";
import { detectBorderedTables, mergeCollinear } from "../tables/detectBordered";
import { effectiveType, mergeTables, setCellValue, setColumnType, tableConfidence, tableStats, deleteColumn, setHasHeader } from "../tables/tableModel";
import { computeBodyFontSize } from "../paragraphs";
import { DEFAULT_DETECTION, type ExtractedTable, type PageData } from "../types";

import simple from "../../fixtures/simple-bordered-table.json";
import merged from "../../fixtures/bordered-merged-cells.json";
import borderless from "../../fixtures/borderless-aligned-table.json";
import multi from "../../fixtures/multi-page-table.json";
import numeric from "../../fixtures/numeric-columns.json";
import currency from "../../fixtures/currency-columns.json";
import dates from "../../fixtures/date-columns.json";

const pages = (f: { pages: unknown }) => f.pages as PageData[];
const body = (ps: PageData[]) => computeBodyFontSize(ps);
const analyze = (p: PageData, ps: PageData[]) => analyzePage(p, DEFAULT_DETECTION, body(ps));
const values = (t: ExtractedTable) => t.rows.map((r) => r.cells.map((c) => c.value));

describe("bordered tables", () => {
  it("reconstructs the simple bordered fixture", () => {
    const ps = pages(simple);
    const { tables, blocks } = analyze(ps[0], ps);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect(t.source).toBe("bordered");
    expect(t.hasHeader).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(simple.expected.tables[0].header);
    expect(values(t)).toEqual(simple.expected.tables[0].rows);
    // title and note stay as text, table text is not duplicated into paragraphs
    expect(blocks.map((b) => b.text)).toEqual(["Sales overview", "Figures are preliminary."]);
    expect(blocks[0].kind).toBe("heading");
  });

  it("merges collinear line fragments", () => {
    const frag = (x0: number, x1: number) => ({ orientation: "h" as const, x0, x1, y0: 100, y1: 100, thickness: 1 });
    const out = mergeCollinear([frag(0, 50), frag(50.5, 100), frag(200, 260)], "h");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ x0: 0, x1: 100 });
  });

  it("detects merged cells where the inner border is missing", () => {
    const p = pages(merged)[0];
    const raw = detectBorderedTables(p);
    expect(raw).toHaveLength(1);
    const span = raw[0].cells.find((c) => c.row === 0 && c.col === 0)!;
    expect(span.colSpan).toBe(4);
    const t = analyze(p, [p]).tables[0];
    expect(t.hasHeader).toBe(false); // first row is a single merged title, not a header
  });

  it("ignores pages without lines", () => {
    const p = pages(borderless)[0];
    expect(detectBorderedTables(p)).toHaveLength(0);
  });
});

describe("borderless tables", () => {
  it("clusters aligned text into columns (Chinese + English)", () => {
    const ps = pages(borderless);
    const { tables, blocks } = analyze(ps[0], ps);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect(t.source).toBe("borderless");
    expect(t.columns.map((c) => c.name)).toEqual(borderless.expected.tables[0].header);
    expect(values(t)).toEqual(borderless.expected.tables[0].rows);
    // prose above the table is one paragraph, not a table
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain("must not be detected");
    expect(blocks[0].text).toContain("running text");
  });

  it("does not turn running text into a table", () => {
    const p: PageData = { ...pages(borderless)[0] };
    p.items = p.items.filter((i) => i.y0 < 150);
    expect(analyze(p, [p]).tables).toHaveLength(0);
  });
});

describe("column types", () => {
  it("numeric columns", () => {
    const ps = pages(numeric);
    const t = analyze(ps[0], ps).tables[0];
    expect(t.columns.map((_, i) => effectiveType(t, i))).toEqual(numeric.expected.columnTypes);
    expect(values(t)).toEqual(numeric.expected.tables[0].rows);
  });

  it("currency columns", () => {
    const ps = pages(currency);
    const t = analyze(ps[0], ps).tables[0];
    expect(t.columns.map((_, i) => effectiveType(t, i))).toEqual(currency.expected.columnTypes);
  });

  it("date columns", () => {
    const ps = pages(dates);
    const t = analyze(ps[0], ps).tables[0];
    expect(t.columns.map((_, i) => effectiveType(t, i))).toEqual(dates.expected.columnTypes);
  });
});

describe("multi-page tables", () => {
  it("suggests and performs the merge, dropping the repeated header", () => {
    const ps = pages(multi);
    const all = ps.flatMap((p) => analyze(p, ps).tables);
    expect(all).toHaveLength(2);
    const sug = suggestContinuations(all, ps);
    expect(sug).toHaveLength(1);
    const merged = mergeTables(all[0], all[1]);
    expect(merged.rows.map((r) => r.cells.map((c) => c.value))).toEqual(multi.expected.merged!.rows);
    expect(merged.regions.map((r) => r.page)).toEqual([1, 2]);
  });

  it("keeps a differing header of the continuation as a data row", () => {
    const ps = pages(multi);
    const [a, b] = ps.flatMap((p) => analyze(p, ps).tables);
    const renamed = { ...b, columns: b.columns.map((c, i) => (i === 1 ? { ...c, name: "Other" } : c)) };
    expect(mergeTables(a, renamed).rows).toHaveLength(a.rows.length + b.rows.length + 1);
  });
});

describe("editing model", () => {
  const ps = pages(simple);
  const base = () => analyze(ps[0], ps).tables[0];

  it("keeps the original value and marks edited cells as confirmed", () => {
    const t = base();
    const edited = setCellValue(t, t.rows[0].id, 2, "121");
    const cell = edited.rows[0].cells[2];
    expect(cell.value).toBe("121");
    expect(cell.original).toBe("120");
    expect(cell.status).toBe("confirmed");
    expect(tableStats(edited).corrected).toBe(1);
  });

  it("flags type mismatches as needing review and raises confidence after correction", () => {
    const t = base();
    // the user declares the "Units" column numeric, then two OCR-like typos appear in it
    const typed = setColumnType(t, 2, "number");
    const bad = setCellValue(setCellValue(typed, t.rows[0].id, 2, "12O"), t.rows[1].id, 2, "8S");
    // user edits count as confirmed → no review needed; revert status to simulate raw extraction
    const raw: ExtractedTable = {
      ...bad,
      rows: bad.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, status: "auto" as const })) })),
    };
    expect(tableStats(raw).needsReview).toBeGreaterThan(0);
    expect(tableConfidence(raw)).toBeLessThan(tableConfidence(base()));
  });

  it("deletes columns and toggles the header", () => {
    const t = base();
    const d = deleteColumn(t, 0);
    expect(d.columns).toHaveLength(3);
    expect(d.rows[0].cells).toHaveLength(3);
    const noHeader = setHasHeader(t, false);
    expect(noHeader.rows).toHaveLength(t.rows.length + 1);
    expect(noHeader.rows[0].cells[0].value).toBe("Product");
    expect(setHasHeader(noHeader, true).rows).toHaveLength(t.rows.length);
  });
});
