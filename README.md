# PDF Converter Toolkit

Convert **text-based PDFs** into **Excel (.xlsx)** and **Word (.docx)** — entirely in the browser.

* **Private by design** – parsing, table detection and export all run locally (PDF.js, SheetJS, docx). The PDF is never uploaded, there is no backend and no AI/LLM API.
* **Transparent** – every detected table, paragraph and cell is drawn on top of the original PDF page, so you can always see where a value came from.
* **Review before export** – edit headers, columns, types and values; uncertain cells are flagged *Needs review*, edited/confirmed cells are marked *User confirmed*, and the original extracted value is always kept.
* English + 中文 UI, Chinese/English text handling, dark mode.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests + PDF.js integration test (vitest)
npm run build      # outputs a self-contained dist/index.html (+ dist/cmaps)
npm run preview    # serve the production build
npm run fixtures   # regenerate src/fixtures/*.json
```

Requirements: Node 18+.

## Deploy to Vercel

The app is a static Vite build; no server functions are needed.

1. Push the repo to GitHub/GitLab/Bitbucket and **Import Project** in Vercel (framework preset: *Vite*), or run `npx vercel`.
2. Build command `npm run build`, output directory `dist` (already set in `vercel.json`).
3. Nothing else: no environment variables, no API keys.

`public/cmaps/` (PDF.js character maps for Chinese/Japanese/Korean PDFs) is copied into `dist/cmaps` and loaded same-origin only when a PDF needs it, so the app works offline after the first load.

## How to use

1. **Upload** a PDF (or try the built-in sample). Encrypted files prompt for the password (used locally only).
2. The app reads text, coordinates and drawn lines, decides whether the PDF is text-based, and runs detection on all text pages.
   Scanned PDFs show: *“This PDF appears to be scanned. OCR is required for accurate conversion.”*
3. **Pick pages** in the left thumbnail strip (checkbox) and re-run detection from the **Extract** tab, or **drag a region** on the page and assign it to a **table**, **paragraph**, **heading**, or an existing **Excel column**.
4. **Review** in the **Tables** tab: rename headers/columns, change column types (auto / text / number / currency / percentage / date), delete rows/columns, merge a row into the one above (wrapped text), merge tables from several pages, and fix values. The selected cell is highlighted on the PDF page, with *Extracted* vs *Current* values shown.
5. **Export** from the **Export** tab: Excel (separate sheets or one combined sheet) and Word (editable or layout-preserving).

## Supported PDF types

| Type | Support |
| --- | --- |
| Text-based PDFs (exported from Word, Excel, LaTeX, reporting tools) | ✅ |
| Tables with drawn borders (stroked rectangles/lines, or thin filled rectangles) | ✅ |
| Borderless tables with clear column alignment | ✅ (left/right/centre aligned columns) |
| Tables continued across pages (same columns, repeated header) | ✅ suggested or auto-merged |
| Chinese / English / mixed text | ✅ (CJK-aware word joining and widths) |
| Password-protected PDFs | ✅ when the password is known |
| Scanned / image-only PDFs | ❌ detected and reported, OCR is out of scope for v1 |

## Known limitations (v1)

* No OCR. Pages without a text layer are skipped.
* Rotated pages / vertical text are not handled specially (text items are assumed horizontal).
* Merged cells are only reconstructed for *bordered* tables (by missing inner border segments) and for single-segment spanning rows in borderless tables. Complex nested merges can be wrong — use the editor.
* Borderless detection needs consistent gutters between columns. Wrapped multi-line cells become separate rows (use *merge into row above*).
* Multi-column page layouts (newspaper style) are read top-to-bottom, line by line.
* Numbered lists keep their typed marker (“1.”, “（一）”) as text rather than Word auto-numbering; bullet lists become real Word bullets.
* *Layout-preserving* Word mode uses absolutely positioned frames and floating tables: faithful, but harder to edit. Highly designed PDFs will not be pixel-perfect.
* Images are exported as PNG crops of the rendered page region (so overlays on top of an image are included).
* Ambiguous day/month dates (03/04/2024) are flagged; choose the order in the Extract tab.
* The SheetJS community edition (`xlsx`) is only used to *write* workbooks (never to parse untrusted files). It cannot write cell styling (bold header, colours), only values, number formats, merges, column widths and comments.

## How table detection and export work

```
PDF ──PDF.js──► PageData { items[x0,y0,x1,y1,font,bold], rules[h/v lines], images[] }   lib/pdf/*
                │
                ├─► detectBordered   lib/tables/detectBordered.ts
                ├─► detectBorderless lib/tables/detectBorderless.ts
                ├─► paragraphs       lib/paragraphs.ts   (headings, lists, runs)
                ▼
            RawTable ──reconstruct──► ExtractedTable (editable model)             lib/tables/reconstruct.ts
                ▼
            tableModel (edit, merge, confidence, “needs review”)                  lib/tables/tableModel.ts
                ▼
            export/excel.ts (SheetJS)      export/word.ts (docx)
```

**Coordinates.** PDF user space has its origin bottom-left. `extractPage` converts every text run, drawn line and image once, through the viewport transform, into *page points with a top-left origin* (1 pt = 1/72″). Everything in `lib/` uses that space; the viewer multiplies by the zoom factor for screen pixels (`lib/coords.ts`).

**Bordered tables.** Operator-list paths are walked with a tracked CTM (`lib/pdf/graphics.ts`); stroked segments and thin filled rectangles become horizontal/vertical rules. Collinear fragments are merged, touching h/v lines form connected components, and the distinct x/y positions of the lines form the cell grid. A shared edge that is less than 60 % covered by a drawn line means the two cells are merged (row/col span). Text items are assigned to cells by their centre point; text poking >35 % into a neighbour is flagged.

**Borderless tables.** Items are clustered into lines (y), split into segments at gaps wider than *column gap × font size*, grouped into blocks of ≥ 2-segment lines, and the x-axis projection of the segments yields *gutters* (uncovered x ranges) which separate columns — independent of left/right/centre alignment. Blocks are rejected when they look like prose (long segments), are mostly empty, or have poorly aligned columns.

**Reconstruction.** Cell text is rebuilt per cell (lines → words, no spaces between CJK characters). The first row is a header unless it contains numbers/dates. Column types are inferred from values (`lib/valueParse.ts`: numbers, `1.234,56`, `(1,234)` negatives, `$ € £ ¥ 元`, `12.5 %`, ISO / `2024年3月5日` / `Mar 5, 2024` / `MM/DD/YYYY`).

**Confidence & review.** Confidence = detector confidence × (1 − 0.6 × share of cells needing review). A cell needs review when the detector flagged it, its value does not match the column type, or a date is ambiguous. Editing or confirming a cell makes it *User confirmed*; `original` is never overwritten.

**Excel.** Typed cells with number formats (`z`), currency symbols preserved in the format, negatives, percentages as fractions, dates as Excel serials, merges, column widths, optional *Needs review* comments, separate or combined sheets.

**Word.** *Editable* mode: headings, paragraphs (bold/italic runs), bullets, native tables (with spans, header row repeated, numeric columns right-aligned), images. *Layout* mode: one section per page at the PDF page size with frames/floating tables/images at the original coordinates.

## Adding a new table pattern

1. Decide where it belongs:
   * the table has **drawn lines** → extend `detectBorderedTables` (e.g. open tables with only horizontal rules: add the extra case before the `nCols < 2` check);
   * it is **text-only** → add a strategy in `detectBorderlessTables`, or tune `splitSegments` / `findGutters`.
2. Return a `RawTable` (`rowEdges`, `colEdges`, `cells` with `items`, `confidence`). Everything downstream (editing, export, overlays) works automatically.
3. Register it in `analyzePage` (`src/lib/analyze.ts`) — e.g. run it after the existing detectors on the items not yet claimed by a table.
4. Add a fixture: extend `scripts/generate-fixtures.mjs` (`grid()` helper), run `npm run fixtures`, and add a test in `src/lib/__tests__/detection.test.ts`.
5. New value formats (dates, currencies) go in `src/lib/valueParse.ts` with a test in `valueParse.test.ts`.

## Adding OCR in a later phase

The data flow is already OCR-ready because everything downstream consumes `PageData`:

1. Pages flagged `looksScanned` are skipped today (`analyzePage` callers in `useWorkspace.ts`).
2. Add `lib/ocr/ocrPage.ts` that renders the page to a canvas (`renderPage` in `lib/pdf/loader.ts`), runs a local OCR engine (e.g. `tesseract.js` with the `chi_sim+eng` language packs, loaded from `/public`, still fully offline), and converts word boxes (pixels) to `TextItem`s in page points: `pt = px / (renderScale × devicePixelRatio)`; set `fontSize ≈ box height × 0.8`, `bold=false`.
3. Return a `PageData` with those items and `rules` detected from the bitmap (e.g. Hough/morphological line detection) or an empty list (borderless detection then handles it).
4. Mark OCR-derived cells with `suspect: ["reason.ocr"]` so they all show *Needs review* until confirmed.
5. Remove the scanned-page guards in `ExtractPanel.tsx` / `useWorkspace.ts` and keep the warning as “OCR was used — verify values”.

## Project layout

```
src/
  lib/
    coords.ts              coordinate conversion + geometry
    pdf/                   loader (PDF.js), extractPage (text), graphics (lines/images)
    tables/                detectBordered, detectBorderless, reconstruct, tableModel, continuation
    paragraphs.ts          headings / lists / paragraphs
    regionExtract.ts       manual region → table / paragraph / heading / column
    valueParse.ts          numbers, currency, percent, dates
    export/excel.ts        SheetJS workbook
    export/word.ts         docx document (editable + layout)
    storage/db.ts          IndexedDB drafts + history (never stores the PDF)
    i18n/                  en / zh dictionaries
    samplePdf.ts           generates the built-in sample PDF
    __tests__/             vitest suites
  fixtures/*.json          simple bordered, merged cells, borderless, multi-page, numeric, currency, date
  components/, hooks/      React UI + state
```

## Privacy notes

* No network requests are made with your data. Fonts/CMaps/worker are bundled or same-origin.
* Drafts (extracted tables and settings) and conversion history are kept in IndexedDB only; use **Clear local data** in the header to delete them. The PDF file itself is never stored.
