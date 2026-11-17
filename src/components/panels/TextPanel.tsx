import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { BlockKind } from "../../lib/types";
import type { Workspace } from "../../hooks/useWorkspace";
import { cn } from "../../utils/cn";
import { Badge, Button, Check, Icon, ICONS, Panel, Select } from "../ui";

const CAP = 80;

export function TextPanel({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const [onlyCurrent, setOnlyCurrent] = useState(true);
  const [cap, setCap] = useState(CAP);
  const blocks = ws.blocks.filter((b) => !onlyCurrent || b.page === ws.currentPage);
  const images = ws.images.filter((i) => !onlyCurrent || i.page === ws.currentPage);

  return (
    <div className="space-y-3">
      <Panel title={t("text.title", { n: blocks.length })} action={<Check checked={onlyCurrent} onChange={setOnlyCurrent} label={t("text.onlyCurrent")} />}>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("text.hint")}</p>
      </Panel>

      {blocks.length === 0 && images.length === 0 && (
        <Panel>
          <p className="py-6 text-center text-sm text-slate-500">{t("text.none")}</p>
        </Panel>
      )}

      {blocks.slice(0, cap).map((b) => (
        <div
          key={b.id}
          className={cn(
            "rounded-xl border bg-white p-2.5 shadow-sm dark:bg-slate-800/60",
            b.id === ws.focusBlockId ? "border-violet-400 ring-1 ring-violet-400" : "border-slate-200 dark:border-slate-700/70",
            !b.included && "opacity-60",
          )}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Select
              value={b.kind}
              onChange={(e) => ws.updateBlock(b.id, { kind: e.target.value as BlockKind })}
              className="!py-0.5 !text-xs"
              aria-label={t("text.kind")}
            >
              <option value="heading">{t("kind.heading")}</option>
              <option value="paragraph">{t("kind.paragraph")}</option>
              <option value="list-bullet">{t("kind.list-bullet")}</option>
              <option value="list-number">{t("kind.list-number")}</option>
            </Select>
            {b.kind === "heading" && (
              <Select value={b.level} onChange={(e) => ws.updateBlock(b.id, { level: Number(e.target.value) as 1 | 2 | 3 })} className="!py-0.5 !text-xs" aria-label={t("region.headingLevel")}>
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </Select>
            )}
            <Badge tone="slate">p{b.page}</Badge>
            {b.manual && <Badge tone="indigo">{t("text.manual")}</Badge>}
            {b.status === "confirmed" && <Badge tone="green">{t("cell.userConfirmed")}</Badge>}
            <span className="ml-auto flex items-center gap-1">
              <Check checked={b.included} onChange={(v) => ws.updateBlock(b.id, { included: v })} label={<span className="text-xs">{t("text.include")}</span>} />
              <Button size="xs" variant="danger" onClick={() => ws.removeBlock(b.id)} aria-label={t("common.delete")}>
                <Icon d={ICONS.trash} className="h-3 w-3" />
              </Button>
            </span>
          </div>
          <textarea
            value={b.text}
            rows={Math.min(8, Math.max(1, Math.ceil(b.text.length / 52)))}
            onFocus={() => {
              ws.setFocusBlockId(b.id);
              if (b.page !== ws.currentPage) ws.setCurrentPage(b.page);
            }}
            onChange={(e) => ws.updateBlock(b.id, { text: e.target.value })}
            className={cn(
              "w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900",
              b.kind === "heading" && "font-semibold",
              b.bold && b.kind !== "heading" && "font-semibold",
              b.italic && "italic",
            )}
          />
          {b.text !== b.original && (
            <p className="mt-1 text-[11px] text-slate-500">
              {t("cell.original")}: <span className="font-mono">{b.original.slice(0, 120)}</span>
              <button className="ml-2 text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => ws.updateBlock(b.id, { text: b.original, status: "auto" })}>
                {t("cell.revert")}
              </button>
            </p>
          )}
        </div>
      ))}
      {blocks.length > cap && (
        <Button className="w-full" onClick={() => setCap(cap + CAP)}>
          {t("table.showMore", { n: blocks.length - cap })}
        </Button>
      )}

      {images.length > 0 && (
        <Panel title={t("text.images", { n: images.length })}>
          {images.map((im) => (
            <Check key={im.id} checked={im.included} onChange={(v) => ws.updateImage(im.id, v)} label={t("text.imageOn", { n: im.page })} />
          ))}
        </Panel>
      )}
    </div>
  );
}
