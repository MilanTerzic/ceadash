import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { useLang } from "@/lib/i18n";

/**
 * Global data-loading feedback for the dashboard workspace:
 *  - a slim indeterminate progress bar pinned under the header
 *  - a small floating "loading data" pill
 * Both appear whenever any dashboard query is fetching (initial load,
 * refresh click, or a date-range change).
 */
export function LoadingBar() {
  const fetching = useIsFetching();
  const { t } = useLang();
  const active = fetching > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    // Keep it on screen briefly so quick refetches still read as feedback.
    const timer = setTimeout(() => setVisible(false), 400);
    return () => clearTimeout(timer);
  }, [active]);

  if (!visible) return null;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent print:hidden"
      >
        <div
          className={`h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent ${
            active ? "animate-loading-sweep" : "opacity-0 transition-opacity duration-300"
          }`}
        />
      </div>
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border/70 bg-surface/95 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-lg backdrop-blur transition-all duration-300 print:hidden ${
          active ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>
          {t("Loading data…", "Učitavanje podataka…")}
          {fetching > 1 ? ` (${fetching})` : ""}
        </span>
      </div>
    </>
  );
}
