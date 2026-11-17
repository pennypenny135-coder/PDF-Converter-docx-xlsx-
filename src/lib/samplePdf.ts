/**
 * Builds a small 2-page sample PDF (pure string/bytes, no dependencies) so users can try the app
 * without uploading anything, and so tests can exercise the real PDF.js pipeline.
 *
 * Contents: heading, paragraph, a bordered table, a borderless table, a bullet list, and a
 * bordered table that continues on page 2 with a repeated header row.
 */
const PAGE_W = 595;
const PAGE_H = 842;

const esc = (s: string) => s.replace(/([\\()])/g, "\\$1");

class Page {
  ops: string[] = [];
  /** `y` is the BASELINE measured from the TOP of the page (we flip to PDF's bottom-left origin). */
  text(x: number, y: number, s: string, size = 10.5, bold = false, align: "l" | "r" = "l") {
    const w = s.length * size * (bold ? 0.56 : 0.5);
    const px = align === "r" ? x - w : x;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${px.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  rect(x: number, yTop: number, w: number, h: number) {
    this.ops.push(`${x} ${(PAGE_H - yTop - h).toFixed(2)} ${w} ${h} re S`);
  }
  /** Bordered grid with right-aligned columns listed in `right`. */
  grid(x: number, yTop: number, colW: number[], rowH: number, data: string[][], right: number[] = []) {
    this.ops.push("0.6 w");
    data.forEach((row, r) => {
      let cx = x;
      row.forEach((cell, c) => {
        this.rect(cx, yTop + r * rowH, colW[c], rowH);
        const base = yTop + r * rowH + rowH * 0.68;
        if (right.includes(c) && r > 0) this.text(cx + colW[c] - 6, base, cell, 10, false, "r");
        else this.text(cx + 6, base, cell, 10, r === 0);
        cx += colW[c];
      });
    });
  }
  /** Table without borders: columns start at `xs`. */
  loose(xs: number[], yTop: number, rowH: number, data: string[][]) {
    data.forEach((row, r) => row.forEach((cell, c) => this.text(xs[c], yTop + r * rowH, cell, 10, r === 0)));
  }
}

function assemble(pages: Page[]): Uint8Array {
  const objs: string[] = [];
  const fontF1 = 3;
  const fontF2 = 4;
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((p, i) => {
    const content = p.ops.join("\n");
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 ${fontF1} 0 R /F2 ${fontF2} 0 R >> >> >>`,
    );
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

export function buildSamplePdf(): Uint8Array {
  const p1 = new Page();
  p1.text(60, 70, "Quarterly Sales Report", 20, true);
  p1.text(60, 100, "This report summarises regional sales for the first half of the year. All figures are in US dollars");
  p1.text(60, 114, "and were compiled from the finance system. Percentages show growth compared with the previous year.");
  p1.text(60, 160, "1. Regional performance", 14, true);
  p1.grid(60, 175, [120, 90, 120, 110], 22, [
    ["Region", "Units", "Revenue", "Growth"],
    ["North", "1,250", "$125,000.00", "12.5%"],
    ["South", "980", "$98,500.50", "8.0%"],
    ["East", "1,430", "$143,250.00", "-2.5%"],
    ["West", "615", "$61,200.00", "5.1%"],
  ], [1, 2, 3]);
  p1.text(60, 322, "2. Team roster", 14, true);
  p1.loose([60, 200, 360], 345, 18, [
    ["Employee", "Department", "Start date"],
    ["Alice Chen", "Marketing", "2021-03-15"],
    ["Bob Smith", "Finance", "2019-11-02"],
    ["Carol Diaz", "Engineering", "2022-07-01"],
    ["Dan Wu", "Sales", "2020-01-20"],
  ]);
  p1.text(60, 462, "- Revenue grew in three of the four regions");
  p1.text(60, 476, "- East needs a recovery plan before Q3");
  p1.text(60, 520, "3. Open orders", 14, true);
  p1.grid(60, 535, [110, 200, 130], 22, [
    ["Order", "Customer", "Amount"],
    ["A-1001", "Northwind Traders", "$1,200.00"],
    ["A-1002", "Contoso Ltd", "$845.25"],
    ["A-1003", "Fabrikam Inc", "($300.00)"],
    ["A-1004", "Adventure Works", "$2,310.80"],
  ], [2]);

  const p2 = new Page();
  p2.text(60, 70, "Open orders (continued)", 14, true);
  p2.grid(60, 90, [110, 200, 130], 22, [
    ["Order", "Customer", "Amount"],
    ["A-1005", "Tailspin Toys", "$99.99"],
    ["A-1006", "Litware", "$4,500.00"],
    ["A-1007", "Wingtip Toys", "$150.00"],
  ], [2]);
  p2.text(60, 230, "Prepared by the finance team. Figures are preliminary and subject to change.");

  return assemble([p1, p2]);
}
