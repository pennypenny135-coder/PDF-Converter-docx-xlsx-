import { useEffect, useMemo, useRef, useState } from "react";
import { clampRect, containsPoint, normalizeRect, pageToScreen, rectArea } from "../lib/coords";
import { useI18n } from "../lib/i18n";
import { renderPage } from "../lib/pdf/loader";
import { cellIssues, effectiveType, tableConfidence } from "../lib/tables/tableModel";
import type { Rect } from "../lib/types";
import type { Workspace } from "../hooks/useWorkspace";
import { cn } from "../utils/cn";
import { Button, Icon, ICONS } from "./ui";

interface Props {
  ws: Workspace;
  pending: { page: number; rect: Rect } | null;
  onRegion: (r: { page: number; rect: Rect } | null) => void;
}

export function PdfViewer({ ws, pending, onRegion }: Props) {
  const { t } = useI18n();
  const page = ws.pages[ws.currentPage - 1];
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [wrapWidth, setWrapWidth] = useState(600);
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [showTables, setShowTables] = useState(true);
  const [showText, setShowText] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapWidth(el.clientWidth));
    ro.observe(el);
    setWrapWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!page) return 1;
    if (zoomMode === "fit") return Math.max(0.3, Math.min(3, (wrapWidth - 24) / page.width));
    return zoomMode;
  }, [zoomMode, wrapWidth, page]);

  // ---- render the PDF page to the canvas (PDF.js, local) ------------------
  useEffect(() => {
    if (!page || !canvasRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setRendering(true);
    (async () => {
      try {
        const pdfPage = await ws.getPdfPage(page.pageNumber);
        if (cancelled || !canvasRef.current) return;
        task = renderPage(pdfPage, canvasRef.current, scale);
        canvasRef.current.style.width = "100%";
        canvasRef.current.style.height = "100%";
        await task.promise;
      } catch {
        /* cancelled renders throw – ignore */
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.pageNumber, scale]);

  if (!page) return null;

  // ---- pointer → page points (see lib/coords.ts) -------------------------
  const toPage = (e: React.PointerEvent): [number, number] => {
    const r = overlayRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode !== "select" || e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = toPage(e);
    setDrag({ x, y, x2: x, y2: y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = toPage(e);
    setDrag({ ...drag, x2: x, y2: y });
  };
  const onUp = () => {
    if (!drag) return;
    const raw = normalizeRect(drag.x, drag.y, drag.x2, drag.y2);
    setDrag(null);
    if (raw.x1 - raw.x0 > 8 && raw.y1 - raw.y0 > 8) {
      onRegion({ page: page.pageNumber, rect: clampRect(raw, page.width, page.height) });
      return;
    }
    // a click: select the smallest table under the pointer, otherwise clear the region
    const hits = ws.tables
      .flatMap((tb) => tb.regions.filter((r) => r.page === page.pageNumber).map((r) => ({ tb, r })))
      .filter(({ r }) => containsPoint(r.rect, drag.x, drag.y))
      .sort((a, b) => rectArea(a.r.rect) - rectArea(b.r.rect));
    if (hits[0]) {
      ws.setSelectedTableId(hits[0].tb.id);
      ws.setTab("tables");
    }
    onRegion(null);
  };

  const dragRect = drag ? normalizeRect(drag.x, drag.y, drag.x2, drag.y2) : null;
  const box = (r: Rect) => {
    const s = pageToScreen(r, scale);
    return { left: s.left, top: s.top, width: s.width, height: s.height };
  };

  const selectedTable = ws.tables.find((x) => x.id === ws.selectedTableId);
  const dateOrder = ws.detection.dateOrder;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white/80 px-2.5 py-1.5 text-xs backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/70">
        <Button size="xs" variant="ghost" disabled={ws.currentPage <= 1} onClick={() => ws.setCurrentPage(ws.currentPage - 1)} aria-label={t("viewer.prev")}>
          ‹
        </Button>
        <span className="tabular-nums text-slate-600 dark:text-slate-300">
          {ws.currentPage} / {ws.pages.length}
        </span>
        <Button size="xs" variant="ghost" disabled={ws.currentPage >= ws.pages.length} onClick={() => ws.setCurrentPage(ws.currentPage + 1)} aria-label={t("viewer.next")}>
          ›
        </Button>
        <span className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
        <Button size="xs" variant="ghost" onClick={() => setZoomMode(Math.max(0.3, +(scale - 0.15).toFixed(2)))} aria-label={t("viewer.zoomOut")}>
          <Icon d={ICONS.zoomOut} className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center tabular-nums text-slate-600 dark:text-slate-300">{Math.round(scale * 100)}%</span>
        <Button size="xs" variant="ghost" onClick={() => setZoomMode(Math.min(4, +(scale + 0.15).toFixed(2)))} aria-label={t("viewer.zoomIn")}>
          <Icon d={ICONS.zoomIn} className="h-3.5 w-3.5" />
        </Button>
        <Button size="xs" variant={zoomMode === "fit" ? "secondary" : "ghost"} onClick={() => setZoomMode("fit")}>
          {t("viewer.fit")}
        </Button>
        <span className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
        <Button size="xs" variant={mode === "select" ? "primary" : "ghost"} onClick={() => setMode("select")} title={t("viewer.selectHint")}>
          <Icon d={ICONS.select} className="h-3.5 w-3.5" /> {t("viewer.select")}
        </Button>
        <Button size="xs" variant={mode === "pan" ? "primary" : "ghost"} onClick={() => setMode("pan")} title={t("viewer.panHint")}>
          <Icon d={ICONS.hand} className="h-3.5 w-3.5" /> {t("viewer.pan")}
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Icon d={ICONS.eye} className="h-3.5 w-3.5 text-slate-400" />
          {[
            [showTables, setShowTables, t("viewer.tables")],
            [showText, setShowText, t("viewer.text")],
            [showWords, setShowWords, t("viewer.words")],
          ].map(([v, set, label], i) => (
            <button
              key={i}
              onClick={() => (set as (b: boolean) => void)(!v)}
              className={cn(
                "rounded-md px-1.5 py-0.5 ring-1 ring-inset transition-colors",
                v ? "bg-indigo-50 text-indigo-700 ring-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/40" : "text-slate-500 ring-slate-300 hover:bg-slate-100 dark:text-slate-400 dark:ring-slate-600 dark:hover:bg-slate-800",
              )}
            >
              {label as string}
            </button>
          ))}
        </span>
      </div>

      {page.looksScanned && (
        <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <Icon d={ICONS.warn} className="mt-0.5" />
          <span>{t("warn.scanned")}</span>
        </div>
      )}

      {/* page */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto bg-slate-200/60 p-3 dark:bg-slate-950/60">
        <div
          className="relative mx-auto shadow-lg ring-1 ring-black/10"
          style={{ width: page.width * scale, height: page.height * scale }}
        >
          <canvas ref={canvasRef} className="block bg-white" />
          {rendering && <div className="absolute inset-0 animate-pulse bg-white/40" />}

          {/* overlay: highlights (pointer-events none) + interaction layer */}
          <div
            ref={overlayRef}
            className={cn("absolute inset-0 select-none", mode === "select" ? "cursor-crosshair touch-none" : "cursor-grab")}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          >
            {showWords && (
              <>
                {page.items.map((it) => (
                  <div key={it.id} className="pointer-events-none absolute border border-fuchsia-500/50" style={box(it)} />
                ))}
                {page.rules.map((r, i) => (
                  <div key={i} className="pointer-events-none absolute bg-rose-500/80" style={{ ...box({ x0: r.x0 - 0.5, x1: r.x1 + 0.5, y0: r.y0 - 0.5, y1: r.y1 + 0.5 }) }} />
                ))}
              </>
            )}

            {showText &&
              ws.blocks
                .filter((b) => b.page === page.pageNumber)
                .map((b) => (
                  <div
                    key={b.id}
                    className={cn(
                      "pointer-events-none absolute border",
                      b.id === ws.focusBlockId ? "border-2 border-violet-600 bg-violet-400/20" : b.kind === "heading" ? "border-violet-500/70 bg-violet-400/10" : "border-slate-500/50 border-dashed",
                      !b.included && "opacity-30",
                    )}
                    style={box(b.rect)}
                  >
                    <span className="absolute -top-3.5 left-0 rounded bg-violet-600 px-1 text-[9px] leading-3 text-white">
                      {b.kind === "heading" ? `H${b.level}` : b.kind === "paragraph" ? "¶" : "•"}
                    </span>
                  </div>
                ))}

            {showText &&
              ws.images
                .filter((i) => i.page === page.pageNumber)
                .map((i) => <div key={i.id} className="pointer-events-none absolute border-2 border-dashed border-orange-500/80" style={box(i.rect)} />)}

            {showTables &&
              ws.tables.flatMap((tb) =>
                tb.regions
                  .filter((r) => r.page === page.pageNumber)
                  .map((r, ri) => {
                    const sel = tb.id === ws.selectedTableId;
                    const conf = tableConfidence(tb, dateOrder);
                    return (
                      <div
                        key={`${tb.id}-${ri}`}
                        className={cn(
                          "pointer-events-none absolute border-2",
                          sel ? "border-indigo-600 bg-indigo-500/10" : "border-sky-500/70 bg-sky-400/5",
                          !tb.included && "border-dashed border-slate-400 bg-transparent",
                        )}
                        style={box(r.rect)}
                      >
                        <button
                          className={cn(
                            "pointer-events-auto absolute -top-5 left-[-2px] flex items-center gap-1 rounded-t px-1.5 text-[10px] font-semibold leading-5 text-white",
                            sel ? "bg-indigo-600" : "bg-sky-600",
                          )}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            ws.setSelectedTableId(tb.id);
                            ws.setTab("tables");
                          }}
                        >
                          {tb.name}
                          <span className={cn("rounded px-1", conf >= 0.8 ? "bg-emerald-500" : conf >= 0.55 ? "bg-amber-500" : "bg-rose-500")}>{Math.round(conf * 100)}%</span>
                        </button>
                      </div>
                    );
                  }),
              )}

            {/* cell grid of the selected table with review/confirmed colouring */}
            {showTables &&
              selectedTable &&
              selectedTable.rows
                .filter((r) => r.page === page.pageNumber)
                .flatMap((r) => {
                  const types = selectedTable.columns.map((_, i) => effectiveType(selectedTable, i, dateOrder));
                  return r.cells.map((c, ci) => {
                    if (c.covered || !c.rect) return null;
                    const issues = cellIssues(c, types[ci], dateOrder).length > 0;
                    const active = ws.selectedCell?.rowId === r.id && ws.selectedCell.col === ci;
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "pointer-events-none absolute border",
                          active ? "z-10 border-2 border-fuchsia-600 bg-fuchsia-400/25" : issues ? "border-amber-500/60 bg-amber-400/25" : c.status === "confirmed" ? "border-emerald-500/50 bg-emerald-400/15" : "border-indigo-400/40",
                        )}
                        style={box(c.rect)}
                      />
                    );
                  });
                })}

            {pending && pending.page === page.pageNumber && <div className="region-marching pointer-events-none absolute bg-indigo-500/10" style={box(pending.rect)} />}
            {dragRect && <div className="pointer-events-none absolute border-2 border-indigo-600 bg-indigo-500/15" style={box(dragRect)} />}
          </div>
        </div>
      </div>
    </div>
  );
}
