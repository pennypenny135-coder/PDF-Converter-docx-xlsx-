import { useI18n } from "../lib/i18n";
import type { Tab, Workspace } from "../hooks/useWorkspace";
import { cn } from "../utils/cn";
import { Button, Icon, ICONS } from "./ui";
import { ExportPanel } from "./panels/ExportPanel";
import { ExtractPanel } from "./panels/ExtractPanel";
import { TablesPanel } from "./panels/TablesPanel";
import { TextPanel } from "./panels/TextPanel";

interface Props {
  ws: Workspace;
  wide: boolean;
  onToggleWide: () => void;
}

export function RightPanel({ ws, wide, onToggleWide }: Props) {
  const { t, lang } = useI18n();
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "extract", label: t("tab.extract") },
    { id: "tables", label: t("tab.tables"), count: ws.tables.length },
    { id: "text", label: t("tab.text"), count: ws.blocks.length },
    { id: "export", label: t("tab.export") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 pt-2 dark:border-slate-700/70 dark:bg-slate-900" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={ws.tab === tb.id}
            onClick={() => ws.setTab(tb.id)}
            className={cn(
              "-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              ws.tab === tb.id ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            {tb.label}
            {tb.count !== undefined && tb.count > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">{tb.count}</span>
            )}
          </button>
        ))}
        <Button size="xs" variant="ghost" className="ml-auto hidden lg:inline-flex" onClick={onToggleWide} title={wide ? t("panel.narrow") : t("panel.wide")}>
          <Icon d={ICONS.expand} className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {ws.draftOffer && (
          <div className="rounded-xl border border-indigo-300 bg-indigo-50 p-3 text-xs text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-100">
            <p className="flex items-start gap-1.5 font-semibold">
              <Icon d={ICONS.history} className="mt-0.5 h-3.5 w-3.5" />
              {t("draft.found", { date: new Date(ws.draftOffer.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : undefined) })}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="xs" variant="primary" onClick={ws.restoreDraft}>
                {t("draft.restore")}
              </Button>
              <Button size="xs" onClick={ws.discardDraft}>
                {t("draft.discard")}
              </Button>
            </div>
          </div>
        )}
        {ws.tab === "extract" && <ExtractPanel ws={ws} />}
        {ws.tab === "tables" && <TablesPanel ws={ws} />}
        {ws.tab === "text" && <TextPanel ws={ws} />}
        {ws.tab === "export" && <ExportPanel ws={ws} />}
      </div>
    </div>
  );
}
