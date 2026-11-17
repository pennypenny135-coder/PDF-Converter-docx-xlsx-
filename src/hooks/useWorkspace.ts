/**
 * Central application state + actions. All heavy lifting is delegated to the pure modules
 * in /lib; this hook only wires them to React state, progress reporting and IndexedDB.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzePage } from "../lib/analyze";
import { overlapRatio } from "../lib/coords";
import { baseName, downloadBlob } from "../lib/download";
import { buildWorkbook, workbookToBytes } from "../lib/export/excel";
import { buildWordDocument, type WordImage } from "../lib/export/word";
import { useI18n } from "../lib/i18n";
import { computeBodyFontSize } from "../lib/paragraphs";
import { cropPageToPng, getOps, openPdf, PdfLoadError, type PDFDocumentProxy, type PDFPageProxy, type PdfErrorCode } from "../lib/pdf/loader";
import { extractPage, summarizeDocument, type DocumentTextSummary } from "../lib/pdf/extractPage";
import { extractRegionBlock, extractRegionLines, extractRegionTable } from "../lib/regionExtract";
import { addHistory, clearAllLocalData, clearHistory, deleteDraft, draftKey, listHistory, loadDraft, saveDraft, type DraftRecord, type HistoryRecord } from "../lib/storage/db";
import { suggestContinuations, type ContinuationSuggestion } from "../lib/tables/continuation";
import { assignColumnValues, mergeTables, tableStats } from "../lib/tables/tableModel";
import { uid } from "../lib/text";
import {
  DEFAULT_DETECTION,
  DEFAULT_EXCEL,
  DEFAULT_WORD,
  type DetectionSettings,
  type ExcelSettings,
  type ExtractedTable,
  type ImageBlock,
  type PageData,
  type Rect,
  type RegionTarget,
  type TextBlock,
  type WordSettings,
} from "../lib/types";

export type Tab = "extract" | "tables" | "text" | "export";
export type Stage = "idle" | "parsing" | "detecting" | "exporting";
export interface Progress {
  stage: Stage;
  value: number;
  label?: string;
}
export interface Notice {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}
export interface LoadError {
  code: PdfErrorCode;
  message: string;
}
export interface SelectedCell {
  tableId: string;
  rowId: string;
  col: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Merge the tables referenced by the continuation suggestions (chains A→B→C collapse into A). */
export function applyContinuations(tables: ExtractedTable[], suggestions: ContinuationSuggestion[]): ExtractedTable[] {
  let list = [...tables];
  const remap = new Map<string, string>();
  const firstPage = (id: string) => tables.find((t) => t.id === id)?.regions[0]?.page ?? 0;
  for (const s of [...suggestions].sort((x, y) => firstPage(x.bId) - firstPage(y.bId))) {
    const aId = remap.get(s.aId) ?? s.aId;
    const a = list.find((t) => t.id === aId);
    const b = list.find((t) => t.id === s.bId);
    if (!a || !b) continue;
    const merged = mergeTables(a, b);
    list = list.filter((t) => t.id !== b.id).map((t) => (t.id === a.id ? merged : t));
    remap.set(b.id, a.id);
  }
  return list;
}

const sortTables = (list: ExtractedTable[]) =>
  [...list].sort((a, b) => (a.regions[0]?.page ?? 0) - (b.regions[0]?.page ?? 0) || (a.regions[0]?.rect.y0 ?? 0) - (b.regions[0]?.rect.y0 ?? 0));

export function useWorkspace() {
  const { t } = useI18n();

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const fileRef = useRef<File | null>(null);
  const noticeId = useRef(0);

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<LoadError | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle", value: 0 });
  const [notices, setNotices] = useState<Notice[]>([]);
  const [file, setFile] = useState<{ name: string; size: number; key: string } | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [summary, setSummary] = useState<DocumentTextSummary | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  const [tables, setTables] = useState<ExtractedTable[]>([]);
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [images, setImages] = useState<ImageBlock[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);

  const [detection, setDetection] = useState<DetectionSettings>(DEFAULT_DETECTION);
  const [excel, setExcel] = useState<ExcelSettings>(DEFAULT_EXCEL);
  const [word, setWord] = useState<WordSettings>(DEFAULT_WORD);

  const [tab, setTab] = useState<Tab>("extract");
  const [draftOffer, setDraftOffer] = useState<DraftRecord | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  const notify = useCallback((kind: Notice["kind"], text: string) => {
    const id = ++noticeId.current;
    setNotices((n) => [...n, { id, kind, text }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const dismissNotice = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);

  const bodyFont = useMemo(() => computeBodyFontSize(pages), [pages]);
  const suggestions = useMemo(() => suggestContinuations(tables, pages), [tables, pages]);

  useEffect(() => {
    listHistory().then(setHistory);
  }, []);

  /* ------------------------------ detection ------------------------------ */

  const detect = useCallback(
    async (pageData: PageData[], pageNums: number[], settings: DetectionSettings, keepManual: boolean) => {
      setProgress({ stage: "detecting", value: 0, label: t("progress.detecting") });
      const body = computeBodyFontSize(pageData);
      const nt: ExtractedTable[] = [];
      const nb: TextBlock[] = [];
      const ni: ImageBlock[] = [];
      for (let i = 0; i < pageNums.length; i++) {
        const p = pageData.find((x) => x.pageNumber === pageNums[i]);
        if (p && !p.looksScanned) {
          const r = analyzePage(p, settings, body);
          nt.push(...r.tables);
          nb.push(...r.blocks);
          ni.push(...r.images);
        }
        setProgress({ stage: "detecting", value: (i + 1) / pageNums.length, label: t("progress.detectingPage", { n: pageNums[i] }) });
        if (i % 3 === 2) await tick();
      }
      const target = new Set(pageNums);
      let mergedTables = nt;
      setTables((old) => {
        const kept = old.filter((x) => !(target.has(x.regions[0]?.page ?? -1) && (!keepManual || x.source !== "manual")));
        let all = sortTables([...kept, ...nt]);
        if (settings.autoMergeContinued) all = applyContinuations(all, suggestContinuations(all, pageData));
        mergedTables = all;
        return all;
      });
      setBlocks((old) => [...old.filter((x) => !(target.has(x.page) && (!keepManual || !x.manual))), ...nb].sort((a, b) => a.page - b.page || a.rect.y0 - b.rect.y0));
      setImages((old) => [...old.filter((x) => !target.has(x.page)), ...ni]);
      setSelectedTableId((cur) => cur ?? nt[0]?.id ?? null);
      setProgress({ stage: "idle", value: 1 });
      return { tables: nt.length, blocks: nb.length, merged: mergedTables.length };
    },
    [t],
  );

  const runDetection = useCallback(
    async (pageNums: number[]) => {
      if (!pages.length || !pageNums.length) return;
      const hasEdits = tables.some((tb) => pageNums.includes(tb.regions[0]?.page ?? -1) && tb.source !== "manual" && tableStats(tb).confirmed > 0);
      if (hasEdits && !window.confirm(t("confirm.redetect"))) return;
      const r = await detect(pages, pageNums, detection, true);
      notify("success", t("notice.detected", { tables: r.tables }));
      if (r.tables) setTab("tables");
    },
    [pages, tables, detection, detect, notify, t],
  );

  /* ------------------------------ opening files ------------------------------ */

  const closeDocument = useCallback(() => {
    pdfRef.current?.destroy();
    pdfRef.current = null;
    fileRef.current = null;
    setStatus("idle");
    setError(null);
    setFile(null);
    setPages([]);
    setSummary(null);
    setTables([]);
    setBlocks([]);
    setImages([]);
    setSelectedTableId(null);
    setSelectedCell(null);
    setSelectedPages(new Set());
    setCurrentPage(1);
    setDraftOffer(null);
    setTab("extract");
    setProgress({ stage: "idle", value: 0 });
  }, []);

  const openFile = useCallback(
    async (f: File, password?: string) => {
      if (!password) closeDocument();
      fileRef.current = f;
      setStatus("loading");
      setError(null);
      setProgress({ stage: "parsing", value: 0, label: t("progress.opening") });
      try {
        const buf = await f.arrayBuffer();
        const doc = await openPdf(buf, password);
        pdfRef.current?.destroy();
        pdfRef.current = doc;
        const ops = getOps();
        const out: PageData[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          out.push(await extractPage(page, ops));
          setProgress({ stage: "parsing", value: i / doc.numPages, label: t("progress.parsingPage", { n: i, total: doc.numPages }) });
          if (i % 2 === 0) await tick();
        }
        const sum = summarizeDocument(out);
        const key = draftKey({ name: f.name, size: f.size, lastModified: f.lastModified });
        setFile({ name: f.name, size: f.size, key });
        setPages(out);
        setSummary(sum);
        setCurrentPage(1);
        const textPages = out.filter((p) => !p.looksScanned && p.charCount > 0).map((p) => p.pageNumber);
        setSelectedPages(new Set(textPages));
        setStatus("ready");
        setProgress({ stage: "idle", value: 1 });

        const draft = await loadDraft(key);
        if (draft && (draft.tables.length || draft.blocks.length)) setDraftOffer(draft);

        if (!sum.isScanned && textPages.length) {
          const r = await detect(out, textPages, DEFAULT_DETECTION, false);
          setTab(r.tables ? "tables" : "extract");
        }
      } catch (e) {
        const err = e instanceof PdfLoadError ? e : new PdfLoadError("unknown", (e as Error)?.message ?? "Unknown error");
        setError({ code: err.code, message: err.message });
        setStatus("error");
        setProgress({ stage: "idle", value: 0 });
      }
    },
    [closeDocument, detect, t],
  );

  const retryWithPassword = useCallback(
    (pw: string) => {
      if (fileRef.current) void openFile(fileRef.current, pw);
    },
    [openFile],
  );

  /* ------------------------------ drafts ------------------------------ */

  const restoreDraft = useCallback(() => {
    if (!draftOffer) return;
    setTables(draftOffer.tables);
    setBlocks(draftOffer.blocks);
    setImages(draftOffer.images);
    setSelectedPages(new Set(draftOffer.selectedPages));
    setDetection(draftOffer.detection);
    setExcel(draftOffer.excel);
    setWord(draftOffer.word);
    setSelectedTableId(draftOffer.tables[0]?.id ?? null);
    setDraftOffer(null);
    notify("success", t("notice.draftRestored"));
  }, [draftOffer, notify, t]);

  const discardDraft = useCallback(() => {
    if (file) void deleteDraft(file.key);
    setDraftOffer(null);
  }, [file]);

  useEffect(() => {
    if (!file || status !== "ready" || progress.stage !== "idle" || draftOffer) return;
    if (!tables.length && !blocks.length) return;
    const h = setTimeout(() => {
      void saveDraft({ key: file.key, fileName: file.name, updatedAt: Date.now(), tables, blocks, images, selectedPages: [...selectedPages], detection, excel, word });
    }, 1200);
    return () => clearTimeout(h);
  }, [file, status, progress.stage, draftOffer, tables, blocks, images, selectedPages, detection, excel, word]);

  /* ------------------------------ editing actions ------------------------------ */

  const updateTable = useCallback((id: string, fn: (t: ExtractedTable) => ExtractedTable) => {
    setTables((all) => all.map((x) => (x.id === id ? fn(x) : x)));
  }, []);

  const removeTable = useCallback(
    (id: string) => {
      setTables((all) => all.filter((x) => x.id !== id));
      setSelectedTableId((cur) => (cur === id ? null : cur));
    },
    [],
  );

  const mergeSelected = useCallback(
    (ids: string[]) => {
      if (ids.length < 2) return;
      setTables((all) => {
        const picked = sortTables(all.filter((x) => ids.includes(x.id)));
        const merged = picked.slice(1).reduce((acc, nxt) => mergeTables(acc, nxt), picked[0]);
        const firstId = picked[0].id;
        const out = all.filter((x) => !ids.includes(x.id) || x.id === firstId).map((x) => (x.id === firstId ? merged : x));
        setSelectedTableId(firstId);
        return out;
      });
      notify("success", t("notice.merged"));
    },
    [notify, t],
  );

  const applySuggestion = useCallback(
    (s: ContinuationSuggestion) => {
      setTables((all) => applyContinuations(all, [s]));
      setSelectedTableId(s.aId);
      notify("success", t("notice.merged"));
    },
    [notify, t],
  );

  const updateBlock = useCallback((id: string, patch: Partial<TextBlock>) => {
    setBlocks((all) =>
      all.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...patch };
        if (patch.text !== undefined && patch.text !== b.text) {
          next.runs = undefined; // edited text loses run-level styling
          next.status = "confirmed";
        }
        return next;
      }),
    );
  }, []);

  const removeBlock = useCallback((id: string) => setBlocks((all) => all.filter((b) => b.id !== id)), []);
  const updateImage = useCallback((id: string, included: boolean) => setImages((all) => all.map((i) => (i.id === id ? { ...i, included } : i))), []);

  /** Manual region → table / paragraph / heading / Excel column. */
  const assignRegion = useCallback(
    (pageNumber: number, rect: Rect, target: RegionTarget): boolean => {
      const page = pages.find((p) => p.pageNumber === pageNumber);
      if (!page) return false;
      if (target.type === "table") {
        const n = tables.filter((x) => x.source === "manual" && x.regions[0]?.page === pageNumber).length + 1;
        const tb = extractRegionTable(page, rect, detection, `P${pageNumber}-R${n}`);
        if (!tb) {
          notify("error", t("notice.regionEmpty"));
          return false;
        }
        setTables((all) => sortTables([...all, tb]));
        setSelectedTableId(tb.id);
        setTab("tables");
        notify("success", t("notice.regionTable", { rows: tb.rows.length, cols: tb.columns.length }));
        return true;
      }
      if (target.type === "column") {
        const lines = extractRegionLines(page, rect);
        if (!lines.length) {
          notify("error", t("notice.regionEmpty"));
          return false;
        }
        updateTable(target.tableId, (tb) => assignColumnValues(tb, target.columnIndex, lines));
        setSelectedTableId(target.tableId);
        setTab("tables");
        notify("success", t("notice.regionColumn", { n: lines.length }));
        return true;
      }
      const blk = extractRegionBlock(page, rect, target.type === "heading" ? { kind: "heading", level: target.level } : { kind: "paragraph" }, bodyFont);
      if (!blk) {
        notify("error", t("notice.regionEmpty"));
        return false;
      }
      setBlocks((all) =>
        [...all.filter((b) => !(b.page === pageNumber && !b.manual && overlapRatio(b.rect, rect) > 0.5)), blk].sort((a, b) => a.page - b.page || a.rect.y0 - b.rect.y0),
      );
      setFocusBlockId(blk.id);
      setTab("text");
      notify("success", t("notice.regionBlock"));
      return true;
    },
    [pages, tables, detection, bodyFont, notify, t, updateTable],
  );

  /* ------------------------------ export ------------------------------ */

  const refreshHistory = useCallback(() => listHistory().then(setHistory), []);

  const exportExcel = useCallback(async () => {
    if (!file) return;
    try {
      setProgress({ stage: "exporting", value: 0.3, label: t("progress.buildingXlsx") });
      await tick();
      const wb = buildWorkbook(tables, excel, detection.dateOrder);
      const bytes = workbookToBytes(wb);
      setProgress({ stage: "exporting", value: 0.9, label: t("progress.saving") });
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${baseName(file.name)}.xlsx`);
      await addHistory({ id: uid("h"), fileName: file.name, format: "xlsx", at: Date.now(), detail: t("history.xlsxDetail", { n: wb.SheetNames.length }) });
      await refreshHistory();
      notify("success", t("notice.exported", { fmt: "Excel" }));
    } catch (e) {
      notify("error", t("notice.exportFailed", { msg: (e as Error).message }));
    } finally {
      setProgress({ stage: "idle", value: 1 });
    }
  }, [file, tables, excel, detection.dateOrder, notify, refreshHistory, t]);

  const exportWord = useCallback(async () => {
    if (!file) return;
    try {
      setProgress({ stage: "exporting", value: 0.05, label: t("progress.preparingDocx") });
      const wordImages: WordImage[] = [];
      const wanted = word.includeImages ? images.filter((i) => i.included) : [];
      for (let i = 0; i < wanted.length; i++) {
        const im = wanted[i];
        const pg = (await pdfRef.current!.getPage(im.page)) as PDFPageProxy;
        const png = await cropPageToPng(pg, im.rect, 2);
        wordImages.push({ id: im.id, page: im.page, rect: im.rect, data: png.data });
        setProgress({ stage: "exporting", value: 0.05 + (0.6 * (i + 1)) / wanted.length, label: t("progress.renderingImages", { n: i + 1, total: wanted.length }) });
      }
      setProgress({ stage: "exporting", value: 0.75, label: t("progress.buildingDocx") });
      await tick();
      const blob = await buildWordDocument(
        { tables, blocks, images: wordImages, pages, dateOrder: detection.dateOrder },
        word,
      );
      downloadBlob(blob, `${baseName(file.name)}.docx`);
      await addHistory({ id: uid("h"), fileName: file.name, format: "docx", at: Date.now(), detail: t(word.mode === "layout" ? "history.docxLayout" : "history.docxEditable") });
      await refreshHistory();
      notify("success", t("notice.exported", { fmt: "Word" }));
    } catch (e) {
      notify("error", t("notice.exportFailed", { msg: (e as Error).message }));
    } finally {
      setProgress({ stage: "idle", value: 1 });
    }
  }, [file, tables, blocks, images, pages, word, detection.dateOrder, notify, refreshHistory, t]);

  const clearHistoryAction = useCallback(async () => {
    await clearHistory();
    await refreshHistory();
  }, [refreshHistory]);

  const wipeLocalData = useCallback(async () => {
    await clearAllLocalData();
    await refreshHistory();
    notify("success", t("notice.wiped"));
  }, [notify, refreshHistory, t]);

  const getPdfPage = useCallback(async (n: number) => (await pdfRef.current!.getPage(n)) as PDFPageProxy, []);

  const togglePage = useCallback((n: number) => {
    setSelectedPages((s) => {
      const nx = new Set(s);
      if (nx.has(n)) nx.delete(n);
      else nx.add(n);
      return nx;
    });
  }, []);

  return {
    status, error, progress, notices, dismissNotice, notify,
    file, pages, summary, currentPage, setCurrentPage, selectedPages, setSelectedPages, togglePage,
    tables, blocks, images, selectedTableId, setSelectedTableId, selectedCell, setSelectedCell, focusBlockId, setFocusBlockId,
    detection, setDetection, excel, setExcel, word, setWord,
    tab, setTab, draftOffer, history, suggestions, bodyFont,
    openFile, retryWithPassword, closeDocument, runDetection,
    restoreDraft, discardDraft,
    updateTable, removeTable, mergeSelected, applySuggestion, updateBlock, removeBlock, updateImage, assignRegion,
    exportExcel, exportWord, clearHistoryAction, wipeLocalData, getPdfPage,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
