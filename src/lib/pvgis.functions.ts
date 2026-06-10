import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// PVGIS seriescalc returns hourly PV output for a coordinate.
// Docs: https://re.jrc.ec.europa.eu/api/seriescalc

const InputSchema = z.object({
  lat: z.number().min(35).max(60),
  lon: z.number().min(10).max(35),
  peakpower: z.number().min(0.1).max(10000).default(1), // kWp
  loss: z.number().min(0).max(40).default(14),
  angle: z.number().min(0).max(90).default(30),
  aspect: z.number().min(-180).max(180).default(0),
  startyear: z.number().int().min(2005).max(2023).default(2020),
  endyear: z.number().int().min(2005).max(2023).default(2020),
});

export type PvgisResult = {
  hourly: number[]; // MWh per MW installed, length ~8760
  yearlyKwhPerKwp: number;
  source: string;
};

export const fetchPvgis = createServerFn({ method: "POST" })
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<PvgisResult> => {
    const url = new URL("https://re.jrc.ec.europa.eu/api/seriescalc");
    url.searchParams.set("lat", String(data.lat));
    url.searchParams.set("lon", String(data.lon));
    url.searchParams.set("peakpower", String(data.peakpower));
    url.searchParams.set("loss", String(data.loss));
    url.searchParams.set("angle", String(data.angle));
    url.searchParams.set("aspect", String(data.aspect));
    url.searchParams.set("pvcalculation", "1");
    url.searchParams.set("startyear", String(data.startyear));
    url.searchParams.set("endyear", String(data.endyear));
    url.searchParams.set("outputformat", "json");
    url.searchParams.set("browser", "0");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`PVGIS request failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      outputs?: { hourly?: { P: number }[] };
    };
    const hourly = json.outputs?.hourly ?? [];
    if (hourly.length === 0) throw new Error("PVGIS returned no hourly data");
    // P is power in W for given peakpower (kWp). Convert to MWh/MW = (W/peakpower_W)
    const peakpowerW = data.peakpower * 1000;
    const perMw = hourly.map((h) => h.P / peakpowerW);
    // Take last 8760 hours
    const trimmed = perMw.slice(-8760);
    const yearlyKwhPerKwp = trimmed.reduce((a, b) => a + b, 0) * 1000; // since per MW · 1h = MWh/MW; × 1000 = kWh/kWp
    return { hourly: trimmed, yearlyKwhPerKwp, source: "PVGIS (JRC)" };
  });
