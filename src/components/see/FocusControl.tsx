import { ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton, Segmented } from "@/components/cea/primitives";
import { useLang } from "@/lib/i18n";
import { fmtDay } from "@/lib/see/format";
import type { Focus } from "@/lib/see/region";

/** Switches a view between the whole period and one delivery day inside it. */
export function FocusControl({
  focus,
  days,
  onChange,
  dayOnly = false,
}: {
  focus: Focus;
  days: string[];
  onChange: (focus: Focus) => void;
  /** Hide the period-average option. */
  dayOnly?: boolean;
}) {
  const { t } = useLang();
  const index = focus.mode === "day" ? days.indexOf(focus.day) : -1;
  const single = days.length <= 1;
  return (
    <div className="flex items-center gap-1.5">
      {!single && !dayOnly && (
        <Segmented
          size="xs"
          ariaLabel={t("Time focus", "Vremenski fokus")}
          value={focus.mode}
          onChange={(mode) =>
            onChange(
              mode === "period" ? { mode: "period" } : { mode: "day", day: days[days.length - 1] },
            )
          }
          options={[
            { value: "day", label: t("Day", "Dan") },
            { value: "period", label: t("Period avg", "Prosek perioda") },
          ]}
        />
      )}
      {focus.mode === "day" && (
        <div className="flex items-center">
          {!single && (
            <IconButton
              label={t("Previous day", "Prethodni dan")}
              onClick={() => index > 0 && onChange({ mode: "day", day: days[index - 1] })}
              className="h-6 w-6"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <span className="num min-w-14 text-center text-xs text-foreground">
            {fmtDay(focus.day)}
          </span>
          {!single && (
            <IconButton
              label={t("Next day", "Sledeći dan")}
              onClick={() =>
                index < days.length - 1 && onChange({ mode: "day", day: days[index + 1] })
              }
              className="h-6 w-6"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
