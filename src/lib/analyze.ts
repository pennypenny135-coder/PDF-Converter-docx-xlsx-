/**
 * Orchestrates detection for one page:
 *   bordered tables → borderless tables (outside bordered areas) → text blocks (outside tables) → images.
 * Pure function over `PageData` so it can be tested with JSON fixtures.
 */
import { inflate } from "./coords";
import { buildImageBlocks, buildTextBlocks } from "./paragraphs";
import { detectBorderedTables } from "./tables/detectBordered";
import { detectBorderlessTables } from "./tables/detectBorderless";
import { buildTable } from "./tables/reconstruct";
import type { DetectionSettings, ExtractedTable, ImageBlock, PageData, TextBlock } from "./types";

export interface PageAnalysis {
  tables: ExtractedTable[];
  blocks: TextBlock[];
  images: ImageBlock[];
}

export function analyzePage(page: PageData, settings: DetectionSettings, bodyFontSize: number): PageAnalysis {
  const bordered = settings.detectBordered ? detectBorderedTables(page) : [];
  const exclusion = bordered.map((t) => inflate(t.bbox, 1));
  const borderless = settings.detectBorderless
    ? detectBorderlessTables(page, { columnGapEm: settings.columnGapEm, minRows: settings.minRows, minCols: 2, excluded: exclusion })
    : [];

  const raws = [...bordered, ...borderless].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const tables = raws.map((raw, i) => buildTable(raw, { name: `P${page.pageNumber}-T${i + 1}` }));

  const blocks = settings.extractText
    ? buildTextBlocks(page, page.items, { bodyFontSize, exclude: raws.map((r) => inflate(r.bbox, 1.5)) })
    : [];
  const images = settings.extractImages ? buildImageBlocks(page) : [];
  return { tables, blocks, images };
}
