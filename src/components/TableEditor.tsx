import { useMemo, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
  addColumn,
  addRow,
  cellIssues,
  confidenceLevel,
  confirmAll,
  confirmCell,
  deleteColumn,
  deleteRow,
  effectiveType,
  mergeRowIntoPrevious,
  renameColumn,
  revertCell,
  setCellValue,
  setColumnType,
  setHasHeader,
  tableConfidence,
  tablePages,
  tableStats,
} from "../lib/tables/tableModel";
import type { ColumnType, ExtractedTable } from "../lib/types";
import type { Workspace } from "../hooks/useWorkspace";
import { cn } from "../utils/cn";
import { Badge, Button, Check, Icon, ICONS, Select } from "./ui";

export function ConfidenceBadge({ value, compact }: { value: number; compact?: boolean }) {
  const { t } = useI18n();
  const level = confidenceLevel(value);
  return (
    <Badge tone={level === "high" ? "green" : level === "medium" ? "amber" : "red"} title={t("confidence.tip")}>
      {compact ? "" : t(`confidence.${level}`) + " · "}
      {Math.round(value * 100)}%
    </Badge>
  );
}

const TYPES: ColumnType[] = ["auto", "text", "number", "currency", "percent", "date"];
const ROW_CAP = 150;

export function TableEditor({ ws, table }: { ws: Workspace; table: ExtractedTable }) {
  const { t } = useI18n();
  const dateOrder = ws.detection.dateOrder;
  const upd = (fn: (t: ExtractedTable) => ExtractedTable) => ws.updateTable(table.id, fn);
  const [visible, setVisible] = useState(ROW_CAP);

  const types = useMemo(() => table.columns.map((_, i) => effectiveType(table, i, dateOrder)), [table, dateOrder]);
  const stats = useMemo(() => tableStats(table, dateOrder), [table, dateOrder]);
  const conf = tableConfidence(table, dateOrder);
  const pages = tablePages(table);
  const multiPage = pages.length > 1;

  const sel = ws.selectedCell?.tableId === table.id ? ws.selectedCell : null;
  const selRow = sel ? table.rows.find((r) => r.id === sel.rowId) : undefined;
  const selCell = selRow?.cells[sel?.col ?? -1];

  const focusCell = (rowId: string, col: number, page: number) => {
    ws.setSelectedCell({ tableId: table.id, rowId, col });
    if (page !== ws.currentPage) ws.setCurrentPage(page);
  };

  const jumpToReview = () => {
    const flat = table.rows.flatMap((r, ri) => r.cells.map((c, ci) => ({ r, c, ri, ci })));
    const start = sel ? flat.findIndex((x) => x.r.id === sel.rowId && x.ci === sel.col) + 1 : 0;
    const order = [...flat.slice(start), ...flat.slice(0, start)];
    const hit = order.find((x) => !x.c.covered && cellIssues(x.c, types[x.ci], dateOrder).length > 0);
    if (!hit) return;
    if (hit.ri >= visible) setVisible(hit.ri + 20);
    focusCell(hit.r.id, hit.ci, hit.r.page);
    setTimeout(() => {
      const el = document.getElementById(hit.c.id);
      el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      el?.focus();
    }, 30);
  };

  const noteText = (n: string) => (n.startsWith("merged:") ? t("note.merged", { n: n.split(":")[1] }) : t(n));

  return (
    <div className="space-y-3">
      {/* title row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={table.name}
          onChange={(e) => upd((x) => ({ ...x, name: e.target.value }))}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold dark:border-slate-600 dark:bg-slate-900"
          aria-label={t("table.name")}
        />
        <Button size="sm" onClick={() => ws.setCurrentPage(pages[0])} title={t("table.showOnPage")}>
          <Icon d={ICONS.eye} className="h-3.5 w-3.5" /> {t("table.showOnPage")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => window.confirm(t("confirm.deleteTable")) && ws.removeTable(table.id)}
          aria-label={t("common.delete")}
        >
          <Icon d={ICONS.trash} className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* confidence + stats */}
      <div className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-600 dark:text-slate-300">{t("confidence.label")}</span>
          <ConfidenceBadge value={conf} />
          <Badge tone="slate">{t(`source.${table.source}`)}</Badge>
          <Badge tone="slate">{multiPage ? t("table.pages", { pages: `${pages[0]}–${pages[pages.length - 1]}` }) : t("table.page", { n: pages[0] })}</Badge>
          {table.notes.map((n) => (
            <Badge key={n} tone="sky">
              {noteText(n)}
            </Badge>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
          <span className={cn(stats.needsReview > 0 && "font-semibold text-amber-700 dark:text-amber-300")}>
            ⚠ {t("table.needsReview", { n: stats.needsReview })}
          </span>
          <span>✓ {t("table.confirmed", { n: stats.confirmed })}</span>
          <span>✎ {t("table.corrected", { n: stats.corrected })}</span>
          {stats.needsReview > 0 && (
            <Button size="xs" variant="secondary" onClick={jumpToReview}>
              {t("table.nextReview")}
            </Button>
          )}
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Check checked={table.hasHeader} onChange={(v) => upd((x) => setHasHeader(x, v))} label={t("table.firstRowHeader")} />
        <Check checked={table.included} onChange={(v) => upd((x) => ({ ...x, included: v }))} label={t("table.include")} />
        <span className="ml-auto flex gap-1">
          <Button size="xs" onClick={() => upd((x) => addRow(x))}>
            <Icon d={ICONS.plus} className="h-3 w-3" /> {t("table.addRow")}
          </Button>
          <Button size="xs" onClick={() => upd(addColumn)}>
            <Icon d={ICONS.plus} className="h-3 w-3" /> {t("table.addColumn")}
          </Button>
          <Button size="xs" variant="success" onClick={() => upd(confirmAll)}>
            <Icon d={ICONS.check} className="h-3 w-3" /> {t("table.confirmAll")}
          </Button>
        </span>
      </div>

      {/* grid */}
      <div className="max-h-[48vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800">
            <tr>
              <th className="w-10 border-b border-r border-slate-200 p-1 text-center text-[10px] font-medium text-slate-400 dark:border-slate-700">#</th>
              {table.columns.map((c, ci) => (
                <th key={c.id} className="min-w-[110px] border-b border-r border-slate-200 p-1 align-top dark:border-slate-700">
                  <div className="flex items-center gap-1">
                    <input
                      value={c.name}
                      onChange={(e) => upd((x) => renameColumn(x, ci, e.target.value))}
                      className={cn(
                        "w-full min-w-0 rounded border bg-white px-1.5 py-1 text-xs font-semibold dark:bg-slate-900",
                        c.nameStatus === "confirmed" ? "border-emerald-400/70" : "border-slate-300 dark:border-slate-600",
                      )}
                      aria-label={t("table.columnName")}
                    />
                    <button
                      className="rounded p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-500/20"
                      onClick={() => upd((x) => deleteColumn(x, ci))}
                      title={t("table.deleteColumn")}
                      aria-label={t("table.deleteColumn")}
                    >
                      <Icon d={ICONS.x} className="h-3 w-3" />
                    </button>
                  </div>
                  <Select value={c.type} onChange={(e) => upd((x) => setColumnType(x, ci, e.target.value as ColumnType))} className="mt-1 w-full !py-0.5 !text-[11px]" aria-label={t("table.columnType")}>
                    {TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {ty === "auto" ? `${t("type.auto")} (${t(`type.${types[ci]}`)})` : t(`type.${ty}`)}
                      </option>
                    ))}
                  </Select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, visible).map((r, ri) => (
              <tr key={r.id} className="group">
                <td className="border-b border-r border-slate-200 bg-slate-50 px-1 text-center align-middle text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="flex flex-col items-center gap-0.5 py-0.5">
                    <span className="tabular-nums">{ri + 1}</span>
                    {multiPage && <span className="rounded bg-indigo-100 px-1 text-[9px] text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">p{r.page}</span>}
                    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {ri > 0 && (
                        <button className="rounded px-0.5 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => upd((x) => mergeRowIntoPrevious(x, r.id))} title={t("table.mergeUp")}>
                          ↥
                        </button>
                      )}
                      <button className="rounded px-0.5 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20" onClick={() => upd((x) => deleteRow(x, r.id))} title={t("table.deleteRow")}>
                        ✕
                      </button>
                    </span>
                  </div>
                </td>
                {r.cells.map((c, ci) => {
                  if (c.covered) return null;
                  const issues = cellIssues(c, types[ci] ?? "text", dateOrder);
                  const corrected = c.value !== c.original;
                  const active = sel?.rowId === r.id && sel.col === ci;
                  return (
                    <td
                      key={c.id}
                      rowSpan={c.rowSpan}
                      colSpan={c.colSpan}
                      className={cn(
                        "relative border-b border-r border-slate-200 p-0 dark:border-slate-700",
                        issues.length ? "bg-amber-50 dark:bg-amber-500/10" : c.status === "confirmed" ? "bg-emerald-50/70 dark:bg-emerald-500/10" : "",
                        active && "outline outline-2 -outline-offset-2 outline-fuchsia-500",
                      )}
                      title={issues.length ? issues.map((i) => t(i.reason)).join("\n") : corrected ? `${t("cell.original")}: ${c.original}` : undefined}
                    >
                      <input
                        id={c.id}
                        value={c.value}
                        onFocus={() => focusCell(r.id, ci, r.page)}
                        onChange={(e) => upd((x) => setCellValue(x, r.id, ci, e.target.value))}
                        className={cn(
                          "w-full bg-transparent px-1.5 py-1.5 pr-4 text-xs focus:outline-none",
                          ["number", "currency", "percent"].includes(types[ci]) && "text-right tabular-nums",
                        )}
                      />
                      {issues.length > 0 && <span className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] text-amber-600 dark:text-amber-400">⚠</span>}
                      {issues.length === 0 && c.status === "confirmed" && <span className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">✓</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={table.columns.length + 1} className="p-4 text-center text-slate-400">
                  {t("table.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {table.rows.length > visible && (
        <Button size="sm" onClick={() => setVisible((v) => v + ROW_CAP)} className="w-full">
          {t("table.showMore", { n: table.rows.length - visible })}
        </Button>
      )}

      {/* selected cell: original vs corrected */}
      {selCell && selRow && sel && (
        <div className="rounded-lg border border-fuchsia-300 bg-fuchsia-50/60 p-2.5 text-xs dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {t("cell.selected", { row: table.rows.indexOf(selRow) + 1, col: sel.col + 1 })} · {t("table.page", { n: selRow.page })}
            </span>
            {selCell.status === "confirmed" ? <Badge tone="green">{t("cell.userConfirmed")}</Badge> : cellIssues(selCell, types[sel.col], dateOrder).length ? <Badge tone="amber">{t("cell.needsReview")}</Badge> : <Badge tone="slate">{t("cell.extracted")}</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">{t("cell.original")}</dt>
            <dd className="break-all font-mono text-slate-800 dark:text-slate-100">{selCell.original || <i className="text-slate-400">{t("cell.empty")}</i>}</dd>
            <dt className="text-slate-500">{t("cell.current")}</dt>
            <dd className="break-all font-mono text-slate-800 dark:text-slate-100">{selCell.value || <i className="text-slate-400">{t("cell.empty")}</i>}</dd>
          </dl>
          {cellIssues(selCell, types[sel.col], dateOrder).map((i) => (
            <p key={i.reason} className="mt-1 text-amber-700 dark:text-amber-300">
              ⚠ {t(i.reason)}
            </p>
          ))}
          <div className="mt-2 flex gap-1.5">
            <Button size="xs" variant="success" onClick={() => upd((x) => confirmCell(x, selRow.id, sel.col))} disabled={selCell.status === "confirmed"}>
              <Icon d={ICONS.check} className="h-3 w-3" /> {t("cell.confirm")}
            </Button>
            <Button size="xs" onClick={() => upd((x) => revertCell(x, selRow.id, sel.col))} disabled={selCell.value === selCell.original && selCell.status === "auto"}>
              {t("cell.revert")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
