import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzePage } from "../analyze";
import { buildWorkbook, sanitizeSheetName, toSheetCell, workbookToBytes } from "../export/excel";
import { buildWordDocument } from "../export/word";
import { computeBodyFontSize } from "../paragraphs";
import { extractRegionTable, extractRegionBlock } from "../regionExtract";
import { assignColumnValues } from "../tables/tableModel";
import { DEFAULT_DETECTION, DEFAULT_EXCEL, DEFAULT_WORD, type PageData } from "../types";

import currency from "../../fixtures/currency-columns.json";
import dates from "../../fixtures/date-columns.json";
import simple from "../../fixtures/simple-bordered-table.json";
import borderless from "../../fixtures/borderless-aligned-table.json";

const page = (f: { pages: unknown }) => (f.pages as PageData[])[0];

describe("excel export", () => {
  it("writes typed cells with formats (currency, negatives, dates)", () => {
    const p = page(currency);
    const { tables } = analyzePage(p, DEFAULT_DETECTION, 10);
    const wb = buildWorkbook(tables, DEFAULT_EXCEL);
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws["A1"].v).toBe("Description");
    expect(ws["B2"]).toMatchObject({ t: "n", v: 1234.5 });
    expect(ws["B2"].z).toContain('"$"');
    expect(ws["B4"].v).toBe(-45.1);
    expect(ws["B5"].v).toBe(-300); // accounting parentheses
    expect(ws["C2"].v).toBe(8000);

    // round-trip through the xlsx binary
    const back = XLSX.read(workbookToBytes(wb), { type: "array" });
    expect(back.Sheets[back.SheetNames[0]]["B2"].v).toBe(1234.5);
  });

  it("writes dates as Excel serial numbers", () => {
    const p = page(dates);
    const { tables } = analyzePage(p, DEFAULT_DETECTION, 10);
    const wb = buildWorkbook(tables, DEFAULT_EXCEL);
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws["B2"].t).toBe("n");
    expect(ws["B2"].z).toBe("yyyy-mm-dd");
    expect(ws["B2"].v).toBe(45356); // 2024-03-05
    expect(ws["C2"].v).toBe(45361); // 2024年3月10日
  });

  it("supports separate and combined sheets", () => {
    const a = analyzePage(page(simple), DEFAULT_DETECTION, 10).tables;
    const b = analyzePage(page(borderless), DEFAULT_DETECTION, 10).tables;
    const sep = buildWorkbook([...a, ...b], { ...DEFAULT_EXCEL, layout: "separate" });
    expect(sep.SheetNames).toHaveLength(2);
    const comb = buildWorkbook([...a, ...b], { ...DEFAULT_EXCEL, layout: "combined" });
    expect(comb.SheetNames).toEqual(["Combined"]);
    expect(comb.Sheets["Combined"]["A1"].v).toBe(a[0].name);
  });

  it("leaves unparsable values as text and sanitises sheet names", () => {
    expect(toSheetCell("abc", "number", true, "auto")).toMatchObject({ t: "s", v: "abc" });
    expect(toSheetCell("12.5", "percent", true, "auto")).toMatchObject({ t: "n", v: 0.125 });
    const used = new Set<string>();
    expect(sanitizeSheetName("a/b:c*?[x]", used)).toBe("a_b_c___x_");
    expect(sanitizeSheetName("a/b:c*?[x]", used)).toMatch(/_2$/);
  });
});

describe("word export", () => {
  const p = page(simple);
  const bodySize = computeBodyFontSize([p]);
  const { tables, blocks } = analyzePage(p, DEFAULT_DETECTION, bodySize);
  const input = { tables, blocks, images: [], pages: [{ pageNumber: 1, width: p.width, height: p.height }] };

  it("builds an editable docx containing a native table", async () => {
    const blob = await buildWordDocument(input, { ...DEFAULT_WORD, mode: "editable" });
    expect(blob.size).toBeGreaterThan(2000);
    const zip = (await import("jszip")).default;
    const z = await zip.loadAsync(await blob.arrayBuffer());
    const xml = await z.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Widget A");
    expect(xml).toContain("Heading1");
  });

  it("builds a layout-preserving docx with positioned frames and floating tables", async () => {
    const blob = await buildWordDocument(input, { ...DEFAULT_WORD, mode: "layout" });
    const zip = (await import("jszip")).default;
    const z = await zip.loadAsync(await blob.arrayBuffer());
    const xml = await z.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:framePr");
    expect(xml).toContain("<w:tblpPr");
  });
});

describe("manual regions", () => {
  const p = page(borderless);

  it("extracts a table from a dragged region (borderless)", () => {
    const t = extractRegionTable(p, { x0: 60, y0: 190, x1: 520, y1: 300 }, DEFAULT_DETECTION, "R1")!;
    expect(t).toBeTruthy();
    expect(t.source).toBe("manual");
    expect(t.columns.length).toBe(3);
    expect(t.rows.length).toBe(4);
  });

  it("extracts a clipped bordered region", () => {
    const sp = page(simple);
    const t = extractRegionTable(sp, { x0: 50, y0: 160, x1: 330, y1: 250 }, DEFAULT_DETECTION, "R2")!;
    expect(t.columns.length).toBe(2);
  });

  it("assigns a region as heading / paragraph", () => {
    const sp = page(simple);
    const b = extractRegionBlock(sp, { x0: 50, y0: 80, x1: 400, y1: 110 }, { kind: "heading", level: 2 }, 10)!;
    expect(b.kind).toBe("heading");
    expect(b.level).toBe(2);
    expect(b.text).toBe("Sales overview");
  });

  it("assigns a region to an existing Excel column by y position", () => {
    const sp = page(simple);
    const t = extractRegionTable(sp, { x0: 50, y0: 130, x1: 500, y1: 300 }, DEFAULT_DETECTION, "T")!;
    const out = assignColumnValues(t, 1, [{ value: "Mid", y: t.rows[0].rect!.y0 + 5, page: 1 }]);
    expect(out.rows[0].cells[1].value).toBe("Mid");
    expect(out.rows[0].cells[1].original).not.toBe("Mid");
    expect(out.rows[0].cells[1].status).toBe("confirmed");
  });
});
