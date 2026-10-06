// Light/dark theme (md/10.md 4.1): dark slate by default, remembered per browser. Shared by the
// sidebar's settings row; the effect keeps <html data-theme> and the browser theme color in sync.
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const THEME_KEY = "coronarytwin.theme";

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage blocked */ }
  return "dark";
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0C1018" : "#F4F6FB");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}
