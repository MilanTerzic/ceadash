import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";

export type Theme = "dark" | "light";
const STORAGE_KEY = "cea.theme";

/** Runs before first paint so a saved light theme never flashes dark. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

const ThemeCtx = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") setThemeState("light");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx) ?? { theme: "dark" as Theme, setTheme: () => {} };
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLang();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <IconButton
      label={
        next === "light"
          ? t("Switch to light theme", "Svetla tema")
          : t("Switch to dark theme", "Tamna tema")
      }
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </IconButton>
  );
}
