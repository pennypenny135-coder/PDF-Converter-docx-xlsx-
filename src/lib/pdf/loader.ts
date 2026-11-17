/**
 * PDF.js bootstrap: worker setup, opening documents with friendly typed errors,
 * rendering pages to canvas, and cropping regions to PNG for Word export.
 *
 * Everything runs locally: the PDF bytes never leave the browser. The worker is
 * bundled inline (`?worker&inline`) so no network request is needed at runtime.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline";
import type { OpsTable } from "./graphics";
import type { Rect } from "../types";

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

export type PdfErrorCode = "encrypted" | "wrong-password" | "corrupt" | "empty" | "unknown";

export class PdfLoadError extends Error {
  code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Operator ids from the PDF.js build we are bundled with. */
export function getOps(): OpsTable {
  const o = pdfjs.OPS as unknown as Record<string, number>;
  return {
    save: o.save,
    restore: o.restore,
    transform: o.transform,
    setLineWidth: o.setLineWidth,
    constructPath: o.constructPath,
    stroke: o.stroke,
    closeStroke: o.closeStroke,
    fill: o.fill,
    eoFill: o.eoFill,
    fillStroke: o.fillStroke,
    eoFillStroke: o.eoFillStroke,
    closeFillStroke: o.closeFillStroke,
    closeEOFillStroke: o.closeEOFillStroke,
    paintFormXObjectBegin: o.paintFormXObjectBegin,
    paintFormXObjectEnd: o.paintFormXObjectEnd,
    paintImageXObject: o.paintImageXObject,
    paintInlineImageXObject: o.paintInlineImageXObject,
  };
}

export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  ensureWorker();
  if (data.byteLength < 8) throw new PdfLoadError("empty", "The file is empty or too small to be a PDF.");
  const head = new Uint8Array(data.slice(0, 1024));
  const headStr = String.fromCharCode(...head);
  if (!headStr.includes("%PDF-")) throw new PdfLoadError("corrupt", "This file does not look like a PDF (missing %PDF header).");

  // PDF.js transfers the buffer to the worker, so give it a copy.
  // CMaps (shipped in /public/cmaps) are needed for Chinese/Japanese/Korean PDFs that use predefined
  // character encodings. They are same-origin static files — no external request is made.
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    password,
    isEvalSupported: false,
    cMapUrl: "./cmaps/",
    cMapPacked: true,
  });
  try {
    return await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string };
    if (err?.name === "PasswordException") {
      throw new PdfLoadError(err.code === 2 ? "wrong-password" : "encrypted", "This PDF is password-protected.");
    }
    if (err?.name === "InvalidPDFException" || err?.name === "MissingPDFException" || err?.name === "FormatError") {
      throw new PdfLoadError("corrupt", "This PDF is corrupted or not a valid PDF file.");
    }
    throw new PdfLoadError("unknown", err?.message ?? "Unknown error while opening the PDF.");
  }
}

/** Render a page into a canvas at `scale` (CSS px per point) × devicePixelRatio. Returns a cancel handle. */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, dpr = window.devicePixelRatio || 1) {
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  const ctx = canvas.getContext("2d")!;
  const task = page.render({ canvasContext: ctx, canvas, viewport });
  return task;
}

/** Render a region of a page (page points, top-left origin) to a PNG byte array. */
export async function cropPageToPng(page: PDFPageProxy, rect: Rect, scale = 2): Promise<{ data: Uint8Array; width: number; height: number }> {
  const viewport = page.getViewport({ scale });
  const full = document.createElement("canvas");
  full.width = Math.floor(viewport.width);
  full.height = Math.floor(viewport.height);
  await page.render({ canvasContext: full.getContext("2d")!, canvas: full, viewport }).promise;

  const sx = Math.max(0, Math.floor(rect.x0 * scale));
  const sy = Math.max(0, Math.floor(rect.y0 * scale));
  const sw = Math.max(1, Math.min(full.width - sx, Math.ceil((rect.x1 - rect.x0) * scale)));
  const sh = Math.max(1, Math.min(full.height - sy, Math.ceil((rect.y1 - rect.y0) * scale)));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d")!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob: Blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: sw, height: sh };
}

export type { PDFDocumentProxy, PDFPageProxy };
