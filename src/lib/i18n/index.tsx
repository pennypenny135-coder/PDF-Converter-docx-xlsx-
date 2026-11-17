import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey } from "./en";
import { zh } from "./zh";

export type Lang = "en" | "zh";
const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, zh };

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey | (string & {}), params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem("pct-lang");
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("pct-lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const t = useCallback<I18n["t"]>(
    (key, params) => {
      const dict = dictionaries[lang] as Record<string, string>;
      let s = dict[key] ?? (en as Record<string, string>)[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used inside <I18nProvider>");
  return c;
}
