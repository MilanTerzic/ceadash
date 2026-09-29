import { createServerFn } from "@tanstack/react-start";
import { fetchExplicitAllocation } from "../entsoe.server";
import { BORDERS, PRODUCTS, type ZoneCode, type ProductType } from "../markets";
import { todayISO, offsetISO, clean, expandRange, RangeInput } from "./shared";

export const getCapacity = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const tasks: Array<
      Promise<{ key: string; row: Awaited<ReturnType<typeof fetchExplicitAllocation>> }>
    > = [];
    for (const [a, b] of BORDERS) {
      for (const p of PRODUCTS) {
        tasks.push(
          fetchExplicitAllocation(a, b, p, day).then((row) => ({ key: `${a}_${b}_${p}`, row })),
        );
      }
    }
    const res = await Promise.all(tasks);
    return { day, rows: res.map((r) => ({ key: r.key, ...r.row })) };
  });

export const getCapacityHistory = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      from?: ZoneCode;
      to?: ZoneCode;
      product?: ProductType;
      from_date?: string;
      to_date?: string;
    }) => data ?? {},
  )
  .handler(async ({ data }) => {
    const from = (data.from ?? "RS") as ZoneCode;
    const to = (data.to ?? "HU") as ZoneCode;
    const product = (data.product ?? "daily") as ProductType;
    const today = todayISO();
    const fromDate = clean(data.from_date) ?? offsetISO(-30);
    const toDate = clean(data.to_date) ?? today;
    const s = new Date(fromDate + "T00:00:00Z").getTime();
    const e = new Date(toDate + "T00:00:00Z").getTime();
    const days: string[] = [];
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      const cap = Math.min(e, s + 365 * 86400_000);
      const step =
        product === "monthly" ? 30 * 86400_000 : product === "annual" ? 90 * 86400_000 : 86400_000;
      for (let t = s; t <= cap; t += step) days.push(new Date(t).toISOString().slice(0, 10));
    } else {
      days.push(today);
    }
    const res = await Promise.all(
      days.map((d) =>
        fetchExplicitAllocation(from, to, product, d).then((r) => ({ day: d, ...r })),
      ),
    );
    return {
      from,
      to,
      product,
      from_date: fromDate,
      to_date: toDate,
      rows: res.map((r) => ({
        day: r.day,
        from: r.data.from,
        to: r.data.to,
        product: r.data.product,
        price_eur_mwh: r.data.price_eur_mwh,
        offered_mw: r.data.offered_mw,
        allocated_mw: r.data.allocated_mw,
        unit_warning: r.data.unit_warning,
        source: r.source,
        fetched_at: r.fetched_at,
      })),
    };
  });
