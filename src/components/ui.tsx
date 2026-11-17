import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-500 disabled:bg-indigo-300 dark:disabled:bg-indigo-900/60",
  secondary:
    "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700",
  ghost: "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/70",
  danger: "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-300 dark:disabled:bg-emerald-900/60",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "xs" | "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        size === "xs" && "px-2 py-1 text-xs",
        size === "sm" && "px-2.5 py-1.5 text-xs",
        size === "md" && "px-3.5 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
};

export function Badge({ tone = "slate", children, className, title }: { tone?: keyof typeof TONES; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Panel({ title, children, action, className }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/60", className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Check({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2 py-1 text-sm", disabled && "cursor-not-allowed opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-600 dark:border-slate-600"
      />
      <span>
        <span className="text-slate-700 dark:text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200",
        className,
      )}
    />
  );
}

export function ProgressBar({ value, label, tone = "indigo" }: { value: number; label?: string; tone?: "indigo" | "emerald" }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>{label}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cn("h-full rounded-full transition-[width] duration-200", tone === "indigo" ? "bg-indigo-500" : "bg-emerald-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4 shrink-0", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5",
  table: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14",
  text: "M4 6h16M4 12h16M4 18h10",
  sun: "M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  trash: "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 5 5 9-10",
  warn: "M12 9v4m0 4h.01M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z",
  x: "M6 6l12 12M18 6 6 18",
  download: "M12 4v12m0 0 5-5m-5 5-5-5M4 20h16",
  zoomIn: "M11 5v12M5 11h12M21 21l-4.3-4.3",
  zoomOut: "M5 11h12M21 21l-4.3-4.3",
  select: "M4 4h5M4 4v5M20 4h-5m5 0v5M4 20h5m-5 0v-5m16 5h-5m5 0v-5",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 14a1.5 1.5 0 0 1 2.4-1.8L8 13.5",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  merge: "M7 4v4a5 5 0 0 0 5 5 5 5 0 0 1 5 5v2M17 4v4a5 5 0 0 1-5 5",
  expand: "M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2",
};
