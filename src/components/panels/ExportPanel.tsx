import { useMemo } from "react";
import { useI18n } from "../../lib/i18n";
import { tableStats } from "../../lib/tables/tableModel";
import type { Workspace } from "../../hooks/useWorkspace";
import { cn } from "../../utils/cn";
import { Badge, Button, Check, Icon, ICONS, Panel, ProgressBar, Select } from "../ui";

export function ExportPanel({ ws }: { ws: Workspace }) {
  const { t, lang } = useI18n();
  const { excel, setExcel, word, setWord } = ws;
  const busy = ws.progress.stage !== "idle";

  const stats = useMemo(() => {
    const incl = ws.tables.filter((x) => x.included);
    const review = incl.reduce((n, tb) => n + tableStats(tb, ws.detection.dateOrder).needsReview, 0);
    return {
      tables: incl.length,
      review,
      blocks: ws.blocks.filter((b) => b.included).length,
      images: ws.images.filter((i) => i.included).length,
    };
  }, [ws.tables, ws.blocks, ws.images, ws.detection.dateOrder]);

  return (
    <div className="space-y-3">
      <Panel title={t("export.summary")}>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="indigo">{t("export.nTables", { n: stats.tables })}</Badge>
          <Badge tone="slate">{t("export.nBlocks", { n: stats.blocks })}</Badge>
          <Badge tone="slate">{t("export.nImages", { n: stats.images })}</Badge>
        </div>
        {stats.review > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Icon d={ICONS.warn} className="mt-0.5 h-3.5 w-3.5" /> {t("export.reviewWarn", { n: stats.review })}
          </p>
        ) : (
          stats.tables > 0 && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">✓ {t("export.reviewOk")}</p>
        )}
      </Panel>

      {ws.progress.stage === "exporting" && (
        <Panel>
          <ProgressBar value={ws.progress.value} label={ws.progress.label} tone="emerald" />
        </Panel>
      )}

      {/* Excel */}
      <Panel title="Excel (.xlsx)">
        <div className="grid grid-cols-2 gap-2">
          {(["separate", "combined"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setExcel({ ...excel, layout: l })}
              className={cn(
                "rounded-lg border p-2 text-left text-xs transition-colors",
                excel.layout === l ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
              )}
            >
              <b className="block text-sm">{t(`excel.${l}`)}</b>
              <span className="text-slate-500 dark:text-slate-400">{t(`excel.${l}Hint`)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2">
          <Check checked={excel.includeHeader} onChange={(v) => setExcel({ ...excel, includeHeader: v })} label={t("excel.header")} />
          <Check checked={excel.applyFormats} onChange={(v) => setExcel({ ...excel, applyFormats: v })} label={t("excel.formats")} hint={t("excel.formatsHint")} />
          <Check checked={excel.reviewComments} onChange={(v) => setExcel({ ...excel, reviewComments: v })} label={t("excel.comments")} hint={t("excel.commentsHint")} />
          <Check checked={excel.tableTitles} onChange={(v) => setExcel({ ...excel, tableTitles: v })} disabled={excel.layout !== "combined"} label={t("excel.titles")} />
        </div>
        <Button variant="success" className="mt-2 w-full" disabled={busy || stats.tables === 0} onClick={() => void ws.exportExcel()}>
          <Icon d={ICONS.download} /> {t("export.excel")}
        </Button>
      </Panel>

      {/* Word */}
      <Panel title="Word (.docx)">
        <div className="space-y-2">
          {(["editable", "layout"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setWord({ ...word, mode: m })}
              className={cn(
                "w-full rounded-lg border p-2 text-left text-xs transition-colors",
                word.mode === m ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
              )}
            >
              <b className="block text-sm">{t(`word.${m}`)}</b>
              <span className="text-slate-500 dark:text-slate-400">{t(`word.${m}Hint`)}</span>
            </button>
          ))}
        </div>
        {word.mode === "layout" && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <Icon d={ICONS.warn} className="mt-0.5 h-3.5 w-3.5" /> {t("word.layoutWarn")}
          </p>
        )}
        <div className="mt-2">
          <Check checked={word.includeImages} onChange={(v) => setWord({ ...word, includeImages: v })} label={t("word.images")} />
          {word.mode === "editable" && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              {t("word.pageSize")}
              <Select value={word.pageSize} onChange={(e) => setWord({ ...word, pageSize: e.target.value as typeof word.pageSize })}>
                <option value="source">{t("word.sizeSource")}</option>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </Select>
            </label>
          )}
        </div>
        <Button variant="success" className="mt-2 w-full" disabled={busy || (stats.tables === 0 && stats.blocks === 0 && stats.images === 0)} onClick={() => void ws.exportWord()}>
          <Icon d={ICONS.download} /> {t("export.word")}
        </Button>
      </Panel>

      <Panel
        title={t("history.title")}
        action={
          ws.history.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => void ws.clearHistoryAction()}>
              {t("history.clear")}
            </Button>
          )
        }
      >
        {ws.history.length === 0 ? (
          <p className="text-xs text-slate-500">{t("history.none")}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {ws.history.slice(0, 8).map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <Badge tone={h.format === "xlsx" ? "green" : "sky"}>{h.format}</Badge>
                <span className="min-w-0 flex-1 truncate" title={h.fileName}>
                  {h.fileName}
                </span>
                <span className="shrink-0 text-slate-400" title={h.detail}>
                  {new Date(h.at).toLocaleString(lang === "zh" ? "zh-CN" : undefined, { dateStyle: "short", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <Icon d={ICONS.lock} className="mt-0.5 h-3 w-3" /> {t("history.privacy")}
        </p>
      </Panel>
    </div>
  );
}
