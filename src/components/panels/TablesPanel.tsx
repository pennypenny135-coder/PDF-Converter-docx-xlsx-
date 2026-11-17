import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { tableConfidence, tablePages, tableStats } from "../../lib/tables/tableModel";
import type { Workspace } from "../../hooks/useWorkspace";
import { cn } from "../../utils/cn";
import { Badge, Button, Icon, ICONS, Panel } from "../ui";
import { ConfidenceBadge, TableEditor } from "../TableEditor";

export function TablesPanel({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const selected = ws.tables.find((x) => x.id === ws.selectedTableId);
  const nameOf = (id: string) => ws.tables.find((x) => x.id === id)?.name ?? id;
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!ws.tables.length) {
    return (
      <Panel>
        <div className="py-8 text-center">
          <Icon d={ICONS.table} className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="font-medium text-slate-700 dark:text-slate-200">{t("tables.none")}</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{t("tables.noneHint")}</p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {ws.suggestions.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs dark:border-sky-500/40 dark:bg-sky-500/10">
          <p className="font-semibold text-sky-900 dark:text-sky-200">{t("tables.suggestTitle")}</p>
          {ws.suggestions.map((s) => (
            <div key={s.aId + s.bId} className="flex items-center justify-between gap-2 text-sky-900 dark:text-sky-100">
              <span>{t("tables.suggestItem", { a: nameOf(s.aId), b: nameOf(s.bId) })}</span>
              <Button size="xs" variant="primary" onClick={() => ws.applySuggestion(s)}>
                <Icon d={ICONS.merge} className="h-3 w-3" /> {t("tables.merge")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Panel
        title={t("tables.list", { n: ws.tables.length })}
        action={
          <Button
            size="xs"
            variant="secondary"
            disabled={checked.size < 2}
            onClick={() => {
              ws.mergeSelected([...checked]);
              setChecked(new Set());
            }}
          >
            <Icon d={ICONS.merge} className="h-3 w-3" /> {t("tables.mergeSelected", { n: checked.size })}
          </Button>
        }
      >
        <ul className="max-h-44 space-y-1 overflow-auto">
          {ws.tables.map((tb) => {
            const st = tableStats(tb, ws.detection.dateOrder);
            const pages = tablePages(tb);
            return (
              <li key={tb.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors",
                    tb.id === ws.selectedTableId ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500/60 dark:bg-indigo-500/10" : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-700/40",
                  )}
                >
                  <input type="checkbox" checked={checked.has(tb.id)} onChange={() => toggle(tb.id)} className="accent-indigo-600" aria-label={t("tables.pick")} />
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      ws.setSelectedTableId(tb.id);
                      ws.setCurrentPage(pages[0]);
                    }}
                  >
                    <span className={cn("truncate font-medium", !tb.included && "text-slate-400 line-through")}>{tb.name}</span>
                    <span className="shrink-0 text-slate-400">
                      p{pages[0]}
                      {pages.length > 1 ? `–${pages[pages.length - 1]}` : ""}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {tb.rows.length}×{tb.columns.length}
                    </span>
                  </button>
                  {st.needsReview > 0 && <Badge tone="amber">⚠ {st.needsReview}</Badge>}
                  <ConfidenceBadge value={tableConfidence(tb, ws.detection.dateOrder)} compact />
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {selected ? (
        <Panel>
          <TableEditor key={selected.id} ws={ws} table={selected} />
        </Panel>
      ) : (
        <Panel>
          <p className="py-4 text-center text-sm text-slate-500">{t("tables.pick")}</p>
        </Panel>
      )}
    </div>
  );
}
