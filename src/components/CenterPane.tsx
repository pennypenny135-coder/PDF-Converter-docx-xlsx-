import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { Rect } from "../lib/types";
import type { Workspace } from "../hooks/useWorkspace";
import { PdfViewer } from "./PdfViewer";
import { Button, Icon, ICONS, Select } from "./ui";

/** Viewer + the "assign region" bar. Owns the pending (just-drawn) region. */
export function CenterPane({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<{ page: number; rect: Rect } | null>(null);
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [colTable, setColTable] = useState<string>("");
  const [colIndex, setColIndex] = useState(0);

  useEffect(() => setPending(null), [ws.currentPage]);

  const target = ws.tables.find((x) => x.id === colTable) ?? ws.tables.find((x) => x.id === ws.selectedTableId) ?? ws.tables[0];

  const assign = (fn: (page: number, rect: Rect) => boolean) => {
    if (!pending) return;
    if (fn(pending.page, pending.rect)) setPending(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white/60 px-3 py-2 dark:border-slate-700/70 dark:bg-slate-900/50">
        {pending ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">{t("region.selected", { page: pending.page })}</span>
            <Button size="sm" variant="primary" onClick={() => assign((p, r) => ws.assignRegion(p, r, { type: "table" }))}>
              <Icon d={ICONS.table} className="h-3.5 w-3.5" /> {t("region.asTable")}
            </Button>
            <Button size="sm" onClick={() => assign((p, r) => ws.assignRegion(p, r, { type: "paragraph" }))}>
              ¶ {t("region.asParagraph")}
            </Button>
            <span className="inline-flex items-center gap-1">
              <Button size="sm" onClick={() => assign((p, r) => ws.assignRegion(p, r, { type: "heading", level }))}>
                H {t("region.asHeading")}
              </Button>
              <Select value={level} onChange={(e) => setLevel(Number(e.target.value) as 1 | 2 | 3)} className="!py-1 !text-xs" aria-label={t("region.headingLevel")}>
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </Select>
            </span>
            {ws.tables.length > 0 && target && (
              <span className="inline-flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  onClick={() => assign((p, r) => ws.assignRegion(p, r, { type: "column", tableId: target.id, columnIndex: Math.min(colIndex, target.columns.length - 1) }))}
                >
                  ▥ {t("region.asColumn")}
                </Button>
                <Select value={target.id} onChange={(e) => { setColTable(e.target.value); setColIndex(0); }} className="!max-w-[110px] !py-1 !text-xs" aria-label={t("region.targetTable")}>
                  {ws.tables.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <Select value={Math.min(colIndex, target.columns.length - 1)} onChange={(e) => setColIndex(Number(e.target.value))} className="!max-w-[130px] !py-1 !text-xs" aria-label={t("region.targetColumn")}>
                  {target.columns.map((c, i) => (
                    <option key={c.id} value={i}>
                      {i + 1}. {c.name}
                    </option>
                  ))}
                </Select>
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} className="ml-auto">
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Icon d={ICONS.select} className="h-3.5 w-3.5" />
            {t("region.hint")}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <PdfViewer ws={ws} pending={pending} onRegion={setPending} />
      </div>
    </div>
  );
}
