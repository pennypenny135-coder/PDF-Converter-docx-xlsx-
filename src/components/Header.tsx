import { useI18n } from "../lib/i18n";
import { cn } from "../utils/cn";
import { Button, Icon, ICONS } from "./ui";

interface Props {
  dark: boolean;
  onToggleTheme: () => void;
  fileName?: string;
  onClose?: () => void;
  onWipe: () => void;
}

export function Header({ dark, onToggleTheme, fileName, onClose, onWipe }: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 dark:border-slate-700/70 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Icon d={ICONS.table} className="h-4 w-4" />
        </div>
        <span className="hidden text-sm font-semibold text-slate-900 sm:inline dark:text-white">{t("app.name")}</span>
      </div>

      {fileName && (
        <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <Icon d={ICONS.file} className="text-slate-400" />
          <span className="truncate" title={fileName}>
            {fileName}
          </span>
          <Button size="xs" variant="ghost" onClick={onClose}>
            <Icon d={ICONS.x} className="h-3 w-3" /> {t("header.close")}
          </Button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className="hidden items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 md:inline-flex dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
          title={t("header.privacyTip")}
        >
          <Icon d={ICONS.lock} className="h-3 w-3" /> {t("header.privacy")}
        </span>
        <Button size="xs" variant="ghost" onClick={onWipe} title={t("header.wipeTip")}>
          <Icon d={ICONS.trash} className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("header.wipe")}</span>
        </Button>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-inset ring-slate-300 dark:ring-slate-600" role="group" aria-label={t("header.language")}>
          {(["en", "zh"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn("px-2 py-1 text-xs font-medium", lang === l ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}
            >
              {l === "en" ? "EN" : "中文"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onToggleTheme} aria-label={t("header.theme")}>
          <Icon d={dark ? ICONS.sun : ICONS.moon} />
        </Button>
      </div>
    </header>
  );
}
