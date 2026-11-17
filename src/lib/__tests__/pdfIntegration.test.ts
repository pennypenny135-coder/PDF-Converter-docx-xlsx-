// @vitest-environment node
/**
 * End-to-end check with a REAL PDF parsed by PDF.js (legacy build, no worker thread in Node):
 * a hand-written PDF with a stroked-rectangle table → extractPage → analyzePage.
 */
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzePage } from "../analyze";
import { extractPage, summarizeDocument } from "../pdf/extractPage";
import type { OpsTable } from "../pdf/graphics";
import { DEFAULT_DETECTION, DEFAULT_EXCEL } from "../types";
import { buildSamplePdf } from "../samplePdf";
import { computeBodyFontSize } from "../paragraphs";
import { suggestContinuations } from "../tables/continuation";
import { effectiveType, mergeTables } from "../tables/tableModel";
import { buildWorkbook } from "../export/excel";

const o = pdfjs.OPS as unknown as Record<string, number>;
const ops: OpsTable = {
  save: o.save, restore: o.restore, transform: o.transform, setLineWidth: o.setLineWidth, constructPath: o.constructPath,
  stroke: o.stroke, closeStroke: o.closeStroke, fill: o.fill, eoFill: o.eoFill, fillStroke: o.fillStroke, eoFillStroke: o.eoFillStroke,
  closeFillStroke: o.closeFillStroke, closeEOFillStroke: o.closeEOFillStroke, paintFormXObjectBegin: o.paintFormXObjectBegin,
  paintFormXObjectEnd: o.paintFormXObjectEnd, paintImageXObject: o.paintImageXObject, paintInlineImageXObject: o.paintInlineImageXObject,
};

/** Minimal single-page PDF (Helvetica) from a content stream. */
function makePdf(content: string, w = 595, h = 842): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (pdf += `${String(off).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

/** Draw a table with `re S` cells; PDF y axis points UP (origin bottom-left). */
function tableContent(): string {
  const colX = [60, 200, 300, 420];
  const top = 700; // PDF user space
  const rowH = 24;
  const data = [
    ["Name", "Qty", "Price"],
    ["Apple", "12", "$1.50"],
    ["Pear", "7", "$2.25"],
    ["Plum", "30", "$0.90"],
  ];
  let c = "0.5 w\n";
  data.forEach((row, r) => {
    row.forEach((txt, ci) => {
      const x = colX[ci];
      const y = top - (r + 1) * rowH;
      c += `${x} ${y} ${colX[ci + 1] - colX[ci]} ${rowH} re S\n`;
      c += `BT /${r === 0 ? "F2" : "F1"} 10 Tf ${x + 6} ${y + 8} Td (${txt}) Tj ET\n`;
    });
  });
  c += `BT /F2 18 Tf 60 740 Td (Price list) Tj ET\n`;
  return c;
}

describe("PDF.js integration", () => {
  it("extracts text, rules and a bordered table from a real PDF", async () => {
    const doc = await pdfjs.getDocument({ data: makePdf(tableContent()), useSystemFonts: false, isEvalSupported: false }).promise;
    const page = await extractPage(await doc.getPage(1), ops);

    expect(page.width).toBe(595);
    expect(page.height).toBe(842);
    // text coordinates are top-left based: the title (PDF y=740) sits near the top of the page
    const title = page.items.find((i) => i.str === "Price list")!;
    expect(title.y1).toBeCloseTo(842 - 740 + 0.2 * 18, 0);
    expect(title.bold).toBe(true);
    expect(page.rules.filter((r) => r.orientation === "h").length).toBeGreaterThanOrEqual(8);
    expect(page.looksScanned).toBe(false);
    expect(summarizeDocument([page]).isScanned).toBe(false);

    const { tables, blocks } = analyzePage(page, DEFAULT_DETECTION, 10);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect(t.source).toBe("bordered");
    expect(t.columns.map((c) => c.name)).toEqual(["Name", "Qty", "Price"]);
    expect(t.rows.map((r) => r.cells.map((c) => c.value))).toEqual([
      ["Apple", "12", "$1.50"],
      ["Pear", "7", "$2.25"],
      ["Plum", "30", "$0.90"],
    ]);
    expect(blocks.map((b) => b.text)).toEqual(["Price list"]);
    expect(blocks[0].kind).toBe("heading");
  });

  it("processes the built-in 2-page sample PDF end to end", async () => {
    const doc = await pdfjs.getDocument({ data: buildSamplePdf(), isEvalSupported: false }).promise;
    expect(doc.numPages).toBe(2);
    const pages = [await extractPage(await doc.getPage(1), ops), await extractPage(await doc.getPage(2), ops)];
    const body = computeBodyFontSize(pages);
    const a1 = analyzePage(pages[0], DEFAULT_DETECTION, body);
    const a2 = analyzePage(pages[1], DEFAULT_DETECTION, body);

    // page 1: two bordered tables + one borderless table
    expect(a1.tables.map((t) => t.source)).toEqual(["bordered", "borderless", "bordered"]);
    const [regional, roster, orders] = a1.tables;
    expect(regional.columns.map((c) => c.name)).toEqual(["Region", "Units", "Revenue", "Growth"]);
    expect(regional.rows[2].cells.map((c) => c.value)).toEqual(["East", "1,430", "$143,250.00", "-2.5%"]);
    expect(roster.columns.map((c) => c.name)).toEqual(["Employee", "Department", "Start date"]);
    expect(roster.rows).toHaveLength(4);
    expect(effectiveType(roster, 2)).toBe("date");
    expect(orders.rows[2].cells[2].value).toBe("($300.00)");
    expect(effectiveType(regional, 2)).toBe("currency");
    expect(effectiveType(regional, 3)).toBe("percent");

    // text: title as heading, paragraph, section headings, bullets (tables' text excluded)
    const kinds = a1.blocks.map((b) => `${b.kind}:${b.text.slice(0, 18)}`);
    expect(kinds[0]).toBe("heading:Quarterly Sales Re");
    expect(a1.blocks.find((b) => b.kind === "paragraph")!.text).toContain("previous year.");
    expect(a1.blocks.filter((b) => b.kind === "list-bullet")).toHaveLength(2);
    expect(a1.blocks.some((b) => b.text.includes("Alice"))).toBe(false);

    // page 2: table continues → suggestion + merge drops the repeated header
    const all = [...a1.tables, ...a2.tables];
    const sug = suggestContinuations(all, pages);
    expect(sug).toHaveLength(1);
    const merged = mergeTables(orders, a2.tables[0]);
    expect(merged.rows).toHaveLength(7);
    expect(merged.rows[6].cells[0].value).toBe("A-1007");

    // exports run on real data
    const wb = buildWorkbook([regional, roster, merged], DEFAULT_EXCEL);
    expect(wb.SheetNames).toHaveLength(3);
    expect(wb.Sheets[wb.SheetNames[0]]["D4"].v).toBe(-0.025);
    expect(wb.Sheets[wb.SheetNames[1]]["C2"].t).toBe("n");
  });

  it("flags a page with only an image and no text as scanned", async () => {
    // a 100×100 image XObject placed over the whole page via inline image
    const content = "q 595 0 0 842 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID \x80 EI\nQ\n";
    const doc = await pdfjs.getDocument({ data: makePdf(content), isEvalSupported: false }).promise;
    const page = await extractPage(await doc.getPage(1), ops);
    expect(page.charCount).toBe(0);
    expect(page.images.length).toBeGreaterThan(0);
    expect(page.looksScanned).toBe(true);
    expect(summarizeDocument([page]).isScanned).toBe(true);
  });
});
