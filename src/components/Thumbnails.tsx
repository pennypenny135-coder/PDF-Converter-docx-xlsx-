import { memo, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { renderPage } from "../lib/pdf/loader";
import type { Workspace } from "../hooks/useWorkspace";
import { cn } from "../utils/cn";
import { Badge, Button } from "./ui";

const Thumb = memo(function Thumb({ ws, n }: { ws: Workspace; n: number }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const page = ws.pages[n - 1];
  const active = ws.currentPage === n;
  const selected = ws.selectedPages.has(n);
  const tableCount = ws.tables.filter((x) => x.regions.some((r) => r.page === n)).length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let task: { cancel: () => void } | null = null;
    let dead = false;
    (async () => {
      try {
        const p = await ws.getPdfPage(n);
        if (dead || !canvasRef.current) return;
        task = renderPage(p, canvasRef.current, 112 / page.width, 1);
        canvasRef.current.style.width = "100%";
        canvasRef.current.style.height = "auto";
      } catch {
        /* ignore */
      }
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, n]);

  return (
    <div ref={ref} className="shrink-0">
      <div
        className={cn(
          "relative w-[124px] cursor-pointer rounded-lg border-2 p-1 transition-colors lg:w-full",
          active ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800",
        )}
        onClick={() => ws.setCurrentPage(n)}
        role="button"
        aria-label={t("thumbs.page", { n })}
      >
        <div className="overflow-hidden rounded bg-white shadow ring-1 ring-black/10" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
          <canvas ref={canvasRef} className="block w-full" />
        </div>
        <label className="absolute left-2 top-2 flex items-center rounded bg-white/90 p-0.5 shadow dark:bg-slate-900/90" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => ws.togglePage(n)} className="h-3.5 w-3.5 accent-indigo-600" aria-label={t("thumbs.select", { n })} />
        </label>
        <div className="mt-1 flex items-center justify-between gap-1 px-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="tabular-nums">{n}</span>
          <span className="flex gap-1">
            {page.looksScanned && <Badge tone="amber">{t("thumbs.scanned")}</Badge>}
            {tableCount > 0 && <Badge tone="indigo">{tableCount} ▦</Badge>}
          </span>
        </div>
      </div>
    </div>
  );
});

export function Thumbnails({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const all = ws.pages.map((p) => p.pageNumber);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-700/70">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("thumbs.title")}</span>
        <span className="flex gap-0.5">
          <Button size="xs" variant="ghost" onClick={() => ws.setSelectedPages(new Set(ws.pages.filter((p) => !p.looksScanned).map((p) => p.pageNumber)))}>
            {t("thumbs.all")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => ws.setSelectedPages(new Set())}>
            {t("thumbs.none")}
          </Button>
        </span>
      </div>
      <div className="px-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">{t("thumbs.selected", { n: ws.selectedPages.size, total: all.length })}</div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-auto p-2 lg:flex-col">
        {all.map((n) => (
          <Thumb key={n} ws={ws} n={n} />
        ))}
      </div>
    </div>
  );
}
