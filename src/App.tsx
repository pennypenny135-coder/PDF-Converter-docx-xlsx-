import { useState } from "react";
import { CenterPane } from "./components/CenterPane";
import { Header } from "./components/Header";
import { RightPanel } from "./components/RightPanel";
import { Thumbnails } from "./components/Thumbnails";
import { UploadZone } from "./components/UploadZone";
import { Icon, ICONS, ProgressBar } from "./components/ui";
import { useTheme } from "./hooks/useTheme";
import { useWorkspace } from "./hooks/useWorkspace";
import { I18nProvider, useI18n } from "./lib/i18n";
import { cn } from "./utils/cn";

function Shell() {
  const { t } = useI18n();
  const { dark, toggle } = useTheme();
  const ws = useWorkspace();
  const [wide, setWide] = useState(false);

  const hasDoc = ws.status === "ready" && ws.file;
  const busy = ws.progress.stage !== "idle";

  const confirmWipe = () => window.confirm(t("confirm.wipe")) && void ws.wipeLocalData();

  return (
    <div className="flex h-full flex-col">
      <Header dark={dark} onToggleTheme={toggle} fileName={hasDoc ? ws.file!.name : undefined} onClose={ws.closeDocument} onWipe={confirmWipe} />

      {busy && hasDoc && (
        <div className="border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700/70 dark:bg-slate-900">
          <ProgressBar value={ws.progress.value} label={ws.progress.label} tone={ws.progress.stage === "exporting" ? "emerald" : "indigo"} />
        </div>
      )}

      {!hasDoc ? (
        <main className="min-h-0 flex-1 overflow-auto">
          {ws.status === "loading" ? (
            <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4 px-4">
              <p className="text-center text-lg font-semibold">{t("progress.opening")}</p>
              <ProgressBar value={ws.progress.value} label={ws.progress.label} />
              <p className="text-center text-xs text-slate-500">{t("upload.localOnly")}</p>
            </div>
          ) : (
            <UploadZone onFile={(f) => void ws.openFile(f)} loading={false} error={ws.error} onPassword={ws.retryWithPassword} />
          )}
        </main>
      ) : (
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-auto lg:grid lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden",
            wide ? "lg:grid-cols-[148px_minmax(0,1fr)_min(720px,52vw)]" : "lg:grid-cols-[148px_minmax(0,1fr)_min(450px,40vw)]",
          )}
        >
          <aside className="h-40 shrink-0 border-b border-slate-200 bg-slate-100/70 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r dark:border-slate-700/70 dark:bg-slate-900/60">
            <Thumbnails ws={ws} />
          </aside>
          <section className="h-[80vh] min-h-[420px] shrink-0 lg:h-auto lg:min-h-0">
            <CenterPane ws={ws} />
          </section>
          <aside className="min-h-[60vh] shrink-0 border-t border-slate-200 bg-slate-50 lg:min-h-0 lg:border-l lg:border-t-0 dark:border-slate-700/70 dark:bg-slate-900/80">
            <RightPanel ws={ws} wide={wide} onToggleWide={() => setWide((w) => !w)} />
          </aside>
        </main>
      )}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 px-4" aria-live="polite">
        {ws.notices.map((n) => (
          <div
            key={n.id}
            role={n.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm shadow-lg ring-1",
              n.kind === "error" && "bg-rose-600 text-white ring-rose-700",
              n.kind === "success" && "bg-emerald-600 text-white ring-emerald-700",
              n.kind === "info" && "bg-slate-800 text-white ring-slate-900",
            )}
          >
            <Icon d={n.kind === "error" ? ICONS.warn : ICONS.check} className="mt-0.5" />
            <span className="flex-1">{n.text}</span>
            <button onClick={() => ws.dismissNotice(n.id)} aria-label={t("common.close")} className="opacity-80 hover:opacity-100">
              <Icon d={ICONS.x} className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
