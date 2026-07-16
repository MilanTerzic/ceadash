import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "en" | "sr";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (en: string, sr: string) => string;
};

const LangCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "cea.lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "sr") setLangState(stored);
    } catch {
      // ignore
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "sr" ? "sr-Latn" : "en";
    }
  }, []);

  const t = useCallback((en: string, sr: string) => (lang === "sr" ? sr : en), [lang]);

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangCtx);
  if (!ctx) {
    // Safe fallback (no provider) — defaults to English
    return {
      lang: "en",
      setLang: () => {},
      t: (en) => en,
    };
  }
  return ctx;
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  const next: Lang = lang === "en" ? "sr" : "en";
  const label = lang === "en" ? "EN" : "SRB";
  const aria = lang === "en" ? "Switch to Serbian" : "Prebaci na engleski";
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={aria}
      title={aria}
      className={`inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-foreground/80 hover:bg-muted transition-colors ${className}`}
    >
      <span className={lang === "en" ? "text-foreground" : "text-muted-foreground"}>EN</span>
      <span className="text-muted-foreground/50">/</span>
      <span className={lang === "sr" ? "text-foreground" : "text-muted-foreground"}>SRB</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
