import { useI18n } from "../../lib/i18n";
import type { Workspace } from "../../hooks/useWorkspace";
import { Badge, Button, Check, Icon, ICONS, Panel, ProgressBar, Select } from "../ui";

const fmtSize = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ExtractPanel({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const { summary, detection: d, setDetection } = ws;
  const busy = ws.progress.stage !== "idle";
  const set = (patch: Partial<typeof d>) => setDetection({ ...d, ...patch });

  return (
    <div className="space-y-3">
      {summary?.isScanned && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-semibold">
            <Icon d={ICONS.warn} className="mt-0.5" /> {t("warn.scanned")}
          </p>
          <p className="mt-1 text-xs opacity-90">{t("warn.scannedDetail")}</p>
        </div>
      )}
      {summary?.partiallyScanned && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-semibold">
            <Icon d={ICONS.warn} className="mt-0.5" /> {t("warn.partialScan", { n: summary.scannedPages })}
          </p>
          <p className="mt-1">{t("warn.scanned")}</p>
        </div>
      )}

      {ws.file && summary && (
        <Panel title={t("extract.document")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">{t("extract.file")}</dt>
            <dd className="truncate font-medium" title={ws.file.name}>
              {ws.file.name} <span className="font-normal text-slate-400">({fmtSize(ws.file.size)})</span>
            </dd>
            <dt className="text-slate-500">{t("extract.pages")}</dt>
            <dd>{summary.totalPages}</dd>
            <dt className="text-slate-500">{t("extract.type")}</dt>
            <dd>
              {summary.isScanned ? <Badge tone="amber">{t("extract.typeScanned")}</Badge> : summary.partiallyScanned ? <Badge tone="amber">{t("extract.typeMixed")}</Badge> : <Badge tone="green">{t("extract.typeText")}</Badge>}
            </dd>
          </dl>
        </Panel>
      )}

      <Panel title={t("extract.settings")}>
        <Check checked={d.detectBordered} onChange={(v) => set({ detectBordered: v })} label={t("extract.bordered")} hint={t("extract.borderedHint")} />
        <Check checked={d.detectBorderless} onChange={(v) => set({ detectBorderless: v })} label={t("extract.borderless")} hint={t("extract.borderlessHint")} />
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-600 dark:text-slate-300">
            <span className="mb-1 flex justify-between">
              {t("extract.gap")} <b className="tabular-nums">{d.columnGapEm.toFixed(1)} em</b>
            </span>
            <input type="range" min={0.4} max={2.5} step={0.1} value={d.columnGapEm} onChange={(e) => set({ columnGapEm: Number(e.target.value) })} className="w-full accent-indigo-600" />
            <span className="text-[11px] text-slate-400">{t("extract.gapHint")}</span>
          </label>
          <label className="text-xs text-slate-600 dark:text-slate-300">
            <span className="mb-1 block">{t("extract.minRows")}</span>
            <Select value={d.minRows} onChange={(e) => set({ minRows: Number(e.target.value) })} className="w-full">
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="mt-3 block text-xs text-slate-600 dark:text-slate-300">
          <span className="mb-1 block">{t("extract.dateOrder")}</span>
          <Select value={d.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as typeof d.dateOrder })} className="w-full">
            <option value="auto">{t("extract.dateAuto")}</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </Select>
        </label>
        <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700/60">
          <Check checked={d.extractText} onChange={(v) => set({ extractText: v })} label={t("extract.text")} hint={t("extract.textHint")} />
          <Check checked={d.extractImages} onChange={(v) => set({ extractImages: v })} label={t("extract.images")} />
          <Check checked={d.autoMergeContinued} onChange={(v) => set({ autoMergeContinued: v })} label={t("extract.autoMerge")} hint={t("extract.autoMergeHint")} />
        </div>
      </Panel>

      <Panel title={t("extract.run")}>
        {ws.progress.stage === "detecting" && <div className="mb-3"><ProgressBar value={ws.progress.value} label={ws.progress.label} /></div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !ws.selectedPages.size || !!summary?.isScanned} onClick={() => ws.runDetection([...ws.selectedPages].sort((a, b) => a - b))}>
            {t("extract.runSelected", { n: ws.selectedPages.size })}
          </Button>
          <Button disabled={busy || !!summary?.isScanned} onClick={() => ws.runDetection([ws.currentPage])}>
            {t("extract.runCurrent", { n: ws.currentPage })}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("extract.manualHint")}</p>
      </Panel>
    </div>
  );
}
