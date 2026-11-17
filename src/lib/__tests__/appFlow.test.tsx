// @vitest-environment jsdom
/**
 * UI flow test: upload (built-in sample) → detection → review/edit → language switch → export.
 * PDF.js parsing is real; only canvas rendering / the web worker are mocked (jsdom has neither).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../pdf/loader", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const o = pdfjs.OPS as unknown as Record<string, number>;
  class PdfLoadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    PdfLoadError,
    getOps: () => ({
      save: o.save, restore: o.restore, transform: o.transform, setLineWidth: o.setLineWidth, constructPath: o.constructPath,
      stroke: o.stroke, closeStroke: o.closeStroke, fill: o.fill, eoFill: o.eoFill, fillStroke: o.fillStroke, eoFillStroke: o.eoFillStroke,
      closeFillStroke: o.closeFillStroke, closeEOFillStroke: o.closeEOFillStroke, paintFormXObjectBegin: o.paintFormXObjectBegin,
      paintFormXObjectEnd: o.paintFormXObjectEnd, paintImageXObject: o.paintImageXObject, paintInlineImageXObject: o.paintInlineImageXObject,
    }),
    openPdf: async (data: ArrayBuffer) => {
      if (new Uint8Array(data)[0] !== 0x25) throw new PdfLoadError("corrupt", "bad");
      return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
    },
    renderPage: () => ({ cancel() {}, promise: Promise.resolve() }),
    cropPageToPng: async () => ({ data: new Uint8Array([1]), width: 1, height: 1 }),
  };
});

import App from "../../App";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as any).ResizeObserver = RO;
  (globalThis as any).IntersectionObserver = IO;
  (URL as any).createObjectURL = () => "blob:test";
  (URL as any).revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {};
  if (!(Blob.prototype as any).arrayBuffer) {
    (Blob.prototype as any).arrayBuffer = function () {
      return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(this); });
    };
  }
});
afterEach(cleanup);

describe("App flow", () => {
  it("opens the sample, shows detected tables, tracks edits, switches language and exports", async () => {
    render(<App />);
    expect(screen.getByText(/PDF Converter Toolkit/i, { selector: "h1" })).toBeTruthy();

    fireEvent.click(screen.getByText(/built-in sample/i));
    // tables tab with the first table's header values visible as editable inputs
    await waitFor(() => expect(screen.getByDisplayValue("Region")).toBeTruthy(), { timeout: 15000 });
    expect(screen.getAllByText(/Extraction confidence/i).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("P1-T1")).toBeTruthy();

    // edit a numeric cell → "User confirmed" count increments, original retained
    const cell = screen.getByDisplayValue("1,250");
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "1,300" } });
    await waitFor(() => expect(screen.getByText(/1 user confirmed/i)).toBeTruthy());
    expect(screen.getByText("1,250", { selector: "dd" })).toBeTruthy(); // Extracted value shown in details

    // language switch
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    await waitFor(() => expect(screen.getAllByText(/提取置信度/).length).toBeGreaterThan(0));

    // export tab: Excel download adds a history entry
    fireEvent.click(screen.getByRole("tab", { name: /导出/ }));
    fireEvent.click(await screen.findByRole("button", { name: /下载 Excel/ }));
    await waitFor(() => expect(screen.getAllByText(/已生成 Excel 文件/).length).toBeGreaterThan(0), { timeout: 10000 });
  }, 40000);

  it("shows a clear error for corrupted files", async () => {
    render(<App />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bad = new File(["not a pdf at all"], "broken.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/corrupted|not a valid PDF|已损坏/i));
  });
});
