/**
 * Generates the JSON test fixtures in src/fixtures/*.json.
 *
 *   npm run fixtures
 *
 * A fixture is a hand-built `PageData[]` (the output of lib/pdf/extractPage.ts) plus the
 * rows we expect the detectors to reconstruct. They let us unit-test table detection
 * without needing real PDF files or a browser.
 *
 * Coordinates: page points, TOP-LEFT origin (see src/lib/coords.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fixtures");
mkdirSync(OUT, { recursive: true });

const W = 595;
const H = 842;
const isCJK = (ch) => /[\u2e80-\u9fff\uff00-\uffef]/.test(ch);
const textWidth = (s, fs = 10) => [...s].reduce((w, ch) => w + (isCJK(ch) ? fs : fs * 0.52), 0);

let nid = 0;
function item(page, str, x, baseline, { fs = 10, bold = false, align = "l", width } = {}) {
  const w = textWidth(str, fs);
  let x0 = x;
  if (align === "r") x0 = x - w;
  if (align === "c") x0 = x - w / 2;
  void width;
  return {
    id: `p${page}-t${nid++}`,
    str,
    x0,
    x1: x0 + w,
    y0: baseline - fs * 0.8,
    y1: baseline + fs * 0.2,
    fontSize: fs,
    bold,
    italic: false,
    fontName: bold ? "Helvetica-Bold" : "Helvetica",
  };
}

const hline = (x0, x1, y) => ({ orientation: "h", x0, x1, y0: y, y1: y, thickness: 0.5 });
const vline = (x, y0, y1) => ({ orientation: "v", x0: x, x1: x, y0, y1, thickness: 0.5 });

/**
 * Lay out a grid of strings. `bordered` draws rule lines, otherwise only text is emitted.
 * `align[c]` = "l" | "r" | "c". `skipV` lists [row, edgeIndex] vertical segments to omit (→ merged cells).
 */
function grid(page, { x, y, colW, rowH = 22, data, align = [], bordered = true, skipV = [], boldHeader = true }) {
  const items = [];
  const rules = [];
  const xs = [x];
  colW.forEach((w) => xs.push(xs[xs.length - 1] + w));
  const nR = data.length;
  if (bordered) {
    for (let r = 0; r <= nR; r++) rules.push(hline(xs[0], xs[xs.length - 1], y + r * rowH));
    for (let r = 0; r < nR; r++) {
      xs.forEach((cx, e) => {
        if (!skipV.some(([sr, se]) => sr === r && se === e)) rules.push(vline(cx, y + r * rowH, y + (r + 1) * rowH));
      });
    }
  }
  data.forEach((row, r) => {
    row.forEach((txt, c) => {
      if (!txt) return;
      const base = y + r * rowH + rowH * 0.68;
      const a = align[c] ?? "l";
      const px = a === "r" ? xs[c + 1] - 6 : a === "c" ? (xs[c] + xs[c + 1]) / 2 : xs[c] + 6;
      items.push(item(page, txt, px, base, { align: a, bold: boldHeader && r === 0 }));
    });
  });
  return { items, rules, bottom: y + nR * rowH };
}

function page(pageNumber, parts, extraItems = []) {
  const items = [...parts.flatMap((p) => p.items), ...extraItems];
  const rules = parts.flatMap((p) => p.rules);
  return {
    pageNumber,
    width: W,
    height: H,
    items,
    rules,
    images: [],
    charCount: items.reduce((n, i) => n + i.str.length, 0),
    looksScanned: false,
  };
}

const save = (name, description, pages, expected) => {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ name, description, pages, expected }, null, 2) + "\n");
  console.log("wrote", name);
};

/* 1 ─ simple bordered ------------------------------------------------------ */
{
  const data = [
    ["Product", "Region", "Units", "Status"],
    ["Widget A", "North", "120", "Shipped"],
    ["Widget B", "South", "85", "Pending"],
    ["Gadget C", "East", "40", "Shipped"],
    ["Gadget D", "West", "17", "Cancelled"],
  ];
  const g = grid(1, { x: 60, y: 140, colW: [150, 110, 90, 130], data, align: ["l", "l", "r", "l"] });
  const title = item(1, "Sales overview", 60, 100, { fs: 18, bold: true });
  const note = item(1, "Figures are preliminary.", 60, g.bottom + 30);
  save("simple-bordered-table", "A 4×5 table with full drawn borders, a title above and a note below.", [page(1, [g], [title, note])], {
    tables: [{ page: 1, source: "bordered", header: data[0], rows: data.slice(1) }],
  });
}

/* 1b ─ bordered with merged header cell ---------------------------------- */
{
  const data = [
    ["Quarterly results", "", "", ""],
    ["Region", "Q1", "Q2", "Q3"],
    ["North", "10", "12", "14"],
    ["South", "7", "9", "11"],
  ];
  // omit the vertical segments at edges 1,2,3 in row 0 → "Quarterly results" spans all four columns
  const g = grid(1, { x: 60, y: 140, colW: [120, 90, 90, 90], data, skipV: [[0, 1], [0, 2], [0, 3]], align: ["l", "r", "r", "r"] });
  save("bordered-merged-cells", "Bordered table whose first row is a single merged cell spanning all columns.", [page(1, [g])], {
    tables: [{ page: 1, source: "bordered", merged: { row: 0, col: 0, colSpan: 4 } }],
  });
}

/* 2 ─ borderless aligned (Chinese + English) ------------------------------ */
{
  const data = [
    ["姓名 Name", "部门 Department", "工资 Salary"],
    ["张伟", "研发部 R&D", "12,500"],
    ["Alice Chen", "市场部 Marketing", "9,800"],
    ["李娜", "财务部 Finance", "10,200"],
    ["Bob Smith", "人事部 HR", "8,700"],
  ];
  const g = grid(1, { x: 70, y: 200, colW: [150, 190, 100], rowH: 20, data, bordered: false, align: ["l", "l", "r"] });
  const para = [
    item(1, "This paragraph precedes the table and must not be detected as one.", 70, 120),
    item(1, "It has two lines of ordinary running text that stay together.", 70, 134),
  ];
  save("borderless-aligned-table", "Borderless table with mixed Chinese/English text, a right-aligned numeric column.", [page(1, [g], para)], {
    tables: [{ page: 1, source: "borderless", header: data[0], rows: data.slice(1) }],
  });
}

/* 3 ─ multi-page ------------------------------------------------------------ */
{
  const header = ["ID", "Description", "Amount"];
  const p1rows = [
    ["001", "Consulting", "1,000.00"],
    ["002", "Hosting", "250.00"],
    ["003", "Licences", "3,400.00"],
    ["004", "Support", "800.00"],
    ["005", "Training", "1,500.00"],
  ];
  const p2rows = [
    ["006", "Travel", "420.50"],
    ["007", "Equipment", "2,100.00"],
    ["008", "Misc", "75.00"],
  ];
  const g1 = grid(1, { x: 70, y: 580, colW: [70, 230, 120], data: [header, ...p1rows], align: ["l", "l", "r"] });
  const g2 = grid(2, { x: 70, y: 60, colW: [70, 230, 120], data: [header, ...p2rows], align: ["l", "l", "r"] });
  save("multi-page-table", "One logical table that continues on page 2 with a repeated header row.", [page(1, [g1]), page(2, [g2])], {
    tables: [{ page: 1, header, rows: p1rows }, { page: 2, header, rows: p2rows }],
    merged: { header, rows: [...p1rows, ...p2rows] },
  });
}

/* 4 ─ numeric columns ---------------------------------------------------------- */
{
  const data = [
    ["Item", "Qty", "Unit price", "Change"],
    ["Bolts", "1,200", "0.35", "-5.2"],
    ["Nuts", "980", "0.20", "(3.1)"],
    ["Washers", "15,000", "0.05", "12.75"],
    ["Screws", "42", "1.10", "−0.4"],
  ];
  const g = grid(1, { x: 70, y: 160, colW: [140, 100, 110, 100], rowH: 20, data, bordered: false, align: ["l", "r", "r", "r"] });
  save("numeric-columns", "Numeric columns with thousands separators, decimals, parentheses and minus signs.", [page(1, [g])], {
    tables: [{ page: 1, source: "borderless", header: data[0], rows: data.slice(1) }],
    columnTypes: ["text", "number", "number", "number"],
  });
}

/* 5 ─ currency columns --------------------------------------------------------- */
{
  const data = [
    ["Description", "Amount", "Local"],
    ["Invoice 1001", "$1,234.50", "¥8,000"],
    ["Invoice 1002", "$2,000.00", "¥13,000"],
    ["Refund", "-$45.10", "¥300"],
    ["Adjustment", "($300.00)", "¥1,950"],
  ];
  const g = grid(1, { x: 70, y: 160, colW: [190, 110, 110], data, align: ["l", "r", "r"] });
  save("currency-columns", "Bordered table with $ and ¥ amounts, negative and accounting-style negatives.", [page(1, [g])], {
    tables: [{ page: 1, source: "bordered", header: data[0], rows: data.slice(1) }],
    columnTypes: ["text", "currency", "currency"],
  });
}

/* 6 ─ date columns ----------------------------------------------------------------- */
{
  const data = [
    ["Event", "Date", "Deadline"],
    ["Kick-off", "2024-03-05", "2024年3月10日"],
    ["Review", "2024-04-18", "2024年4月30日"],
    ["Launch", "2024-06-01", "2024年6月15日"],
    ["Retro", "2024-07-09", "2024年7月20日"],
  ];
  const g = grid(1, { x: 70, y: 160, colW: [160, 130, 130], rowH: 20, data, bordered: false });
  save("date-columns", "Borderless table with ISO dates and Chinese-style dates.", [page(1, [g])], {
    tables: [{ page: 1, source: "borderless", header: data[0], rows: data.slice(1) }],
    columnTypes: ["text", "date", "date"],
  });
}
