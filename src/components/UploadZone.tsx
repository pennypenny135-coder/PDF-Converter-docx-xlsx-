import { useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { buildSamplePdf } from "../lib/samplePdf";
import type { LoadError } from "../hooks/useWorkspace";
import { cn } from "../utils/cn";
import { Button, Icon, ICONS } from "./ui";

interface Props {
  onFile: (f: File) => void;
  loading: boolean;
  error: LoadError | null;
  onPassword: (pw: string) => void;
}

export function UploadZone({ onFile, loading, error, onPassword }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pw, setPw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const take = (f?: File | null) => {
    if (!f) return;
    setLocalError(null);
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setLocalError(t("error.notPdf"));
      return;
    }
    onFile(f);
  };

  const needsPassword = error?.code === "encrypted" || error?.code === "wrong-password";
  const errorText = localError ?? (error ? t(`error.${error.code}`) : null);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">{t("app.name")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-600 dark:text-slate-300">{t("upload.tagline")}</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
        onClick={() => !loading && input.current?.click()}
        className={cn(
          "cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          over ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-300 bg-white hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-indigo-500",
          loading && "pointer-events-none opacity-60",
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
          <Icon d={ICONS.upload} className="h-7 w-7" />
        </div>
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("upload.drop")}</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("upload.or")}</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <div className="mt-3 text-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFile(new File([buildSamplePdf() as BlobPart], "sample-report.pdf", { type: "application/pdf", lastModified: 1700000000000 }))}
        >
          {t("upload.sample")}
        </Button>
      </div>

      {errorText && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <div className="flex items-start gap-2">
            <Icon d={ICONS.warn} className="mt-0.5" />
            <div className="w-full">
              <p className="font-medium">{errorText}</p>
              {needsPassword && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onPassword(pw);
                  }}
                >
                  <input
                    type="password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder={t("upload.password")}
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-slate-800 dark:border-rose-500/40 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <Button type="submit" variant="primary" disabled={!pw}>
                    {t("upload.unlock")}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <ul className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["lock", "upload.f1.title", "upload.f1.body"],
          ["table", "upload.f2.title", "upload.f2.body"],
          ["file", "upload.f3.title", "upload.f3.body"],
        ].map(([icon, title, body]) => (
          <li key={title} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-800/50">
            <Icon d={ICONS[icon as keyof typeof ICONS]} className="mb-2 h-5 w-5 text-indigo-500" />
            <p className="font-semibold text-slate-800 dark:text-slate-100">{t(title)}</p>
            <p className="mt-1 text-slate-500 dark:text-slate-400">{t(body)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
