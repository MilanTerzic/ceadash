import { useMemo } from "react";

import { buildRegion, type Focus } from "./region";
import { useBorderSeries, useSeePrices } from "./use-see-data";

/** Loads prices and border series for the shell period and derives the regional view. */
export function useRegion(
  focus: Focus,
  options: {
    scheduled?: boolean;
    ntc?: boolean;
    /** Price range when it should differ from the shell period, e.g. to include tomorrow. */
    priceRange?: { from: string; to: string };
  } = {},
) {
  const prices = useSeePrices(undefined, options.priceRange);
  const physical = useBorderSeries("physical");
  const scheduled = useBorderSeries("scheduled", undefined, Boolean(options.scheduled));
  const ntc = useBorderSeries("ntc", undefined, Boolean(options.ntc));
  const focusKey = focus.mode === "day" ? focus.day : "period";
  const region = useMemo(
    () =>
      buildRegion({
        prices: prices.data,
        physical: physical.data,
        scheduled: scheduled.data,
        ntc: ntc.data,
        focus,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prices.data, physical.data, scheduled.data, ntc.data, focusKey],
  );
  return { region, prices, physical, scheduled, ntc };
}
