/**
 * Word (.docx) generation with the `docx` library.
 *
 * Two modes:
 *  A. "editable"  – a normal flowing document: headings, paragraphs, bullet lists, numbered
 *                   lists (marker kept as text), images and REAL Word tables in reading order.
 *  B. "layout"    – one Word section per PDF page with the same page size. Text blocks become
 *                   absolutely positioned frames, tables become floating native tables and
 *                   images floating pictures, all placed at their PDF coordinates.
 *                   (Positioned frames make later editing harder — the UI warns about it.)
 *
 * Coordinate conversion: PDF page points (top-left origin) → Word twips (1/20 pt) for frames and
 * floating tables, → EMU (1/12700 pt) for floating images. Because Word's page origin is also
 * top-left no y flip is required here.
 */
import {
  AlignmentType,
  BorderStyle,
  FrameAnchorType,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableAnchorType,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
} from "docx";
import { ptToEmu, ptToTwip } from "../coords";
import { effectiveType, exportsHeader } from "../tables/tableModel";
import type { ExtractedTable, PageData, Rect, TextBlock, TextRun as PdfRun, WordSettings } from "../types";

export interface WordImage {
  id: string;
  page: number;
  rect: Rect;
  data: Uint8Array;
}

export interface WordInput {
  tables: ExtractedTable[];
  blocks: TextBlock[];
  images: WordImage[];
  pages: Pick<PageData, "pageNumber" | "width" | "height">[];
  dateOrder?: "auto" | "MDY" | "DMY";
}

const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Calibri", eastAsia: "Microsoft YaHei" };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "9CA3AF" };
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

const PAGE_SIZES = { a4: { w: 11906, h: 16838 }, letter: { w: 12240, h: 15840 } };

function toRuns(block: Pick<TextBlock, "runs" | "text" | "bold" | "italic" | "fontSize">, opts: { size?: number; forceBold?: boolean }): TextRun[] {
  const runs: PdfRun[] = block.runs?.length ? block.runs : [{ text: block.text, bold: block.bold, italic: block.italic }];
  return runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || opts.forceBold,
        italics: r.italic,
        size: opts.size,
        font: FONT,
      }),
  );
}

const isNumericType = (t: string) => t === "number" || t === "currency" || t === "percent";

/** Build a native Word table. `widthsTwips` gives the column widths. */
function buildTable(
  table: ExtractedTable,
  rows: ExtractedTable["rows"],
  widthsTwips: number[],
  opts: { fontHalfPt: number; includeHeader: boolean; float?: { x: number; y: number }; dateOrder: "auto" | "MDY" | "DMY" },
): Table {
  const types = table.columns.map((_, i) => effectiveType(table, i, opts.dateOrder));
  const total = widthsTwips.reduce((a, b) => a + b, 0);
  const mkCell = (text: string, ci: number, opt: { header?: boolean; colSpan?: number; rowSpan?: number }) => {
    const span = opt.colSpan ?? 1;
    const width = widthsTwips.slice(ci, ci + span).reduce((a, b) => a + b, 0);
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      columnSpan: span > 1 ? span : undefined,
      rowSpan: opt.rowSpan && opt.rowSpan > 1 ? opt.rowSpan : undefined,
      borders: CELL_BORDERS,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      shading: opt.header ? { type: ShadingType.CLEAR, fill: "E5E7EB", color: "auto" } : undefined,
      children: text.split("\n").map(
        (line) =>
          new Paragraph({
            alignment: !opt.header && isNumericType(types[ci] ?? "text") ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: line, bold: opt.header, size: opts.fontHalfPt, font: FONT })],
          }),
      ),
    });
  };

  const trs: TableRow[] = [];
  if (opts.includeHeader && exportsHeader(table)) {
    trs.push(new TableRow({ tableHeader: true, cantSplit: true, children: table.columns.map((c, i) => mkCell(c.name, i, { header: true })) }));
  }
  for (const r of rows) {
    const cells: TableCell[] = [];
    r.cells.forEach((c, ci) => {
      if (c.covered) return;
      cells.push(mkCell(c.value, ci, { colSpan: c.colSpan, rowSpan: c.rowSpan }));
    });
    trs.push(new TableRow({ cantSplit: true, children: cells }));
  }
  return new Table({
    rows: trs,
    columnWidths: widthsTwips,
    width: { size: total, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    float: opts.float
      ? {
          horizontalAnchor: TableAnchorType.PAGE,
          verticalAnchor: TableAnchorType.PAGE,
          absoluteHorizontalPosition: opts.float.x,
          absoluteVerticalPosition: opts.float.y,
        }
      : undefined,
  });
}

/** Column widths in twips: proportional to the PDF column edges when known, otherwise equal. */
export function columnWidths(table: ExtractedTable, targetTwips: number): number[] {
  const n = table.columns.length;
  if (!n) return [];
  let weights: number[];
  if (table.colEdges.length === n + 1) {
    weights = table.colEdges.slice(1).map((x, i) => Math.max(8, x - table.colEdges[i]));
  } else {
    weights = Array(n).fill(1);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.max(500, Math.round((w / sum) * targetTwips)));
}

const emptyPara = () => new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new TextRun({ text: "", size: 2 })] });

/* ----------------------------- A. editable mode ----------------------------- */

function buildEditable(input: WordInput, settings: WordSettings) {
  const dateOrder = input.dateOrder ?? "auto";
  const first = input.pages[0];
  const size =
    settings.pageSize === "source" && first
      ? { w: ptToTwip(first.width), h: ptToTwip(first.height) }
      : PAGE_SIZES[settings.pageSize === "letter" ? "letter" : "a4"];
  const margin = 1080; // 0.75"
  const contentWidth = size.w - margin * 2;
  const contentPt = contentWidth / 20;

  interface Entry {
    page: number;
    y: number;
    make: () => (Paragraph | Table)[];
  }
  const entries: Entry[] = [];

  for (const b of input.blocks.filter((x) => x.included)) {
    entries.push({
      page: b.page,
      y: b.rect.y0,
      make: () => {
        if (b.kind === "heading") {
          return [
            new Paragraph({
              heading: HEADINGS[b.level - 1],
              spacing: { before: 240, after: 120 },
              children: toRuns(b, { forceBold: true }),
            }),
          ];
        }
        const size = Math.round(Math.min(Math.max(b.fontSize, 8), 20) * 2);
        if (b.kind === "list-bullet") {
          return [new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: toRuns(b, { size }) })];
        }
        if (b.kind === "list-number") {
          return [new Paragraph({ indent: { left: 720, hanging: 360 }, spacing: { after: 60 }, children: toRuns(b, { size }) })];
        }
        return [new Paragraph({ spacing: { after: 120 }, children: toRuns(b, { size }) })];
      },
    });
  }

  for (const t of input.tables.filter((x) => x.included)) {
    const r0 = t.regions[0];
    if (!r0) continue;
    entries.push({
      page: r0.page,
      y: r0.rect.y0,
      make: () => [
        buildTable(t, t.rows, columnWidths(t, contentWidth), { fontHalfPt: 20, includeHeader: true, dateOrder }),
        new Paragraph({ spacing: { after: 160 }, children: [] }),
      ],
    });
  }

  if (settings.includeImages) {
    for (const im of input.images) {
      entries.push({
        page: im.page,
        y: im.rect.y0,
        make: () => {
          const w = im.rect.x1 - im.rect.x0;
          const h = im.rect.y1 - im.rect.y0;
          const scale = Math.min(1, contentPt / w);
          return [
            new Paragraph({
              spacing: { after: 120 },
              children: [
                new ImageRun({
                  type: "png",
                  data: im.data,
                  transformation: { width: Math.round(w * scale * (96 / 72)), height: Math.round(h * scale * (96 / 72)) },
                }),
              ],
            }),
          ];
        },
      });
    }
  }

  entries.sort((a, b) => a.page - b.page || a.y - b.y);
  const children = entries.flatMap((e) => e.make());
  if (!children.length) throw new Error("Nothing to export: select at least one table, paragraph or image.");

  return {
    sections: [
      {
        properties: { page: { size: { width: size.w, height: size.h }, margin: { top: margin, bottom: margin, left: margin, right: margin } } },
        children,
      },
    ],
  };
}

/* ----------------------------- B. layout mode ----------------------------- */

function buildLayout(input: WordInput, settings: WordSettings) {
  const dateOrder = input.dateOrder ?? "auto";
  const sections: { properties: object; children: (Paragraph | Table)[] }[] = [];

  for (const page of input.pages) {
    const children: (Paragraph | Table)[] = [];
    const pw = ptToTwip(page.width);
    const ph = ptToTwip(page.height);

    for (const b of input.blocks.filter((x) => x.included && x.page === page.pageNumber)) {
      const widthPt = b.rect.x1 - b.rect.x0 + Math.max(8, b.fontSize); // slack so Word does not re-wrap earlier than the PDF did
      children.push(
        new Paragraph({
          heading: b.kind === "heading" ? HEADINGS[b.level - 1] : undefined,
          spacing: { before: 0, after: 0 },
          frame: {
            type: "absolute",
            position: { x: ptToTwip(b.rect.x0), y: ptToTwip(b.rect.y0) },
            width: Math.min(ptToTwip(widthPt), pw - ptToTwip(b.rect.x0)),
            anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
          },
          children: toRuns(b, { size: Math.round(Math.max(b.fontSize, 4) * 2), forceBold: b.kind === "heading" || undefined }),
        }),
      );
    }

    for (const t of input.tables.filter((x) => x.included)) {
      for (const reg of t.regions.filter((r) => r.page === page.pageNumber)) {
        const rows = t.rows.filter((r) => r.page === page.pageNumber);
        if (!rows.length && !exportsHeader(t)) continue;
        const widths = columnWidths(t, ptToTwip(reg.rect.x1 - reg.rect.x0));
        children.push(
          buildTable(t, rows, widths, {
            fontHalfPt: 18,
            includeHeader: true,
            dateOrder,
            float: { x: ptToTwip(reg.rect.x0), y: ptToTwip(reg.rect.y0) },
          }),
        );
        children.push(emptyPara());
      }
    }

    if (settings.includeImages) {
      for (const im of input.images.filter((i) => i.page === page.pageNumber)) {
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({
                type: "png",
                data: im.data,
                transformation: {
                  width: Math.round((im.rect.x1 - im.rect.x0) * (96 / 72)),
                  height: Math.round((im.rect.y1 - im.rect.y0) * (96 / 72)),
                },
                floating: {
                  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: ptToEmu(im.rect.x0) },
                  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: ptToEmu(im.rect.y0) },
                  allowOverlap: true,
                  wrap: { type: TextWrappingType.NONE },
                },
              }),
            ],
          }),
        );
      }
    }

    if (!children.length) continue;
    children.push(emptyPara());
    sections.push({
      properties: { page: { size: { width: pw, height: ph }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children,
    });
  }
  if (!sections.length) throw new Error("Nothing to export: select at least one table, paragraph or image.");
  return { sections };
}

export async function buildWordDocument(input: WordInput, settings: WordSettings): Promise<Blob> {
  const body = settings.mode === "layout" ? buildLayout(input, settings) : buildEditable(input, settings);
  const doc = new Document({
    creator: "PDF Converter Toolkit",
    title: "Converted from PDF",
    description: "Generated locally in the browser",
    styles: {
      default: { document: { run: { font: FONT, size: 21 } } },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: body.sections as ConstructorParameters<typeof Document>[0]["sections"],
  });
  return Packer.toBlob(doc);
}
