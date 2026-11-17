import { useCallback, useEffect, useState } from "react";

/** Dark-mode toggle persisted in localStorage; default follows the OS preference. */
export function useTheme() {
  const [dark, setDark] = useState<boolean>(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("pct-theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return { dark, toggle };
}
