import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toPng } from "html-to-image";
import { Copy, Download, Loader2, Sparkles, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DateRangeControl, useDashboardRange } from "@/components/dashboard/DateRangeControl";
import { fetchMarketPrices } from "@/lib/market.functions";
import {
  generateWeeklyReport,
  generateLinkedInPost,
  fetchRecentNewsForWeekly,
  type WeeklyReport,
  type WeeklyMetrics,
} from "@/lib/weekly.functions";
import {
  bucketByBelgradeDay,
  aggregatePeriod,
  type HourlyPrice,
} from "@/lib/baseload";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/dashboard/weekly")({
  head: () => ({
    meta: [
      { title: "Weekly Market Intelligence — CEA Power Dashboard" },
      { name: "description", content: "AI-generated weekly Serbia / SEE power market summary, RES capture analysis, news digest, and a ready-to-post LinkedIn update with visual export." },
      { property: "og:title", content: "Weekly Market Intelligence — CEA Power Dashboard" },
      { property: "og:description", content: "AI-generated weekly Serbia / SEE power market summary with LinkedIn-ready post and visual." },
    ],
  }),
  component: WeeklyPage,
});

function WeeklyPage() {
  const { t } = useLang();
  const live = useQuery({
    queryKey: ["market-prices"],
    queryFn: () => fetchMarketPrices(),
    staleTime: 60 * 60_000,
  });

  const news = useQuery({
    queryKey: ["weekly-news"],
    queryFn: () => fetchRecentNewsForWeekly(),
    staleTime: 30 * 60_000,
  });

  const data = useMemo<HourlyPrice[]>(
    () => (live.data?.points ?? []).map((p) => ({ ts: new Date(p.ts), price: p.price })),
    [live.data],
  );
  const buckets = useMemo(() => bucketByBelgradeDay(data), [data]);
  const completeDays = useMemo(() => buckets.filter((b) => b.complete), [buckets]);
  const firstAvailable = completeDays[0]?.date;
  const latestAvailable = completeDays[completeDays.length - 1]?.date;

  const { fromKey, toKey, range } = useDashboardRange({ firstAvailable, latestAvailable });

  const metrics = useMemo<WeeklyMetrics | null>(() => {
    if (!fromKey || !toKey) return null;
    const period = aggregatePeriod(buckets, fromKey, toKey);
    if (!isFinite(period.baseload)) return null;

    // Prior week of same length for WoW delta
    const days = completeDays.filter((b) => b.key >= fromKey && b.key <= toKey);
    const span = days.length || 7;
    const prevFromIdx = Math.max(0, completeDays.findIndex((b) => b.key >= fromKey) - span);
    const prevDays = completeDays.slice(prevFromIdx, prevFromIdx + span);
    const baseloadPrev = prevDays.length
      ? prevDays.reduce((a, b) => a + b.baseload, 0) / prevDays.length
      : undefined;

    // midday & evening averages
    const inRangeHours = days.flatMap((d) => d.hours);
    const middayHours = inRangeHours.filter((h) => {
      const hr = new Date(h.ts).getUTCHours(); // approx; for now UTC hour
      return hr >= 9 && hr < 15;
    });
    const eveningHours = inRangeHours.filter((h) => {
      const hr = new Date(h.ts).getUTCHours();
      return hr >= 17 && hr < 22;
    });
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    return {
      weekLabel: `${fromKey} → ${toKey}`,
      baseload: +period.baseload.toFixed(2),
      baseloadPrev: baseloadPrev != null ? +baseloadPrev.toFixed(2) : undefined,
      peakload: period.peakload != null ? +period.peakload.toFixed(2) : null,
      minHour: +period.minHour.toFixed(2),
      maxHour: +period.maxHour.toFixed(2),
      negHours: period.negHours,
      lowHours: period.lowHours,
      volatility: +period.sd.toFixed(2),
      solarCapture: null,
      windCapture: null,
      eveningPeakAvg: mean(eveningHours.map((h) => h.price)),
      middayAvg: mean(middayHours.map((h) => h.price)),
    };
  }, [buckets, completeDays, fromKey, toKey]);

  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [post, setPost] = useState<{ post: string; hashtags: string[] } | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [postLoading, setPostLoading] = useState(false);

  const genReport = useServerFn(generateWeeklyReport);
  const genPost = useServerFn(generateLinkedInPost);

  const onGenerate = async () => {
    if (!metrics) {
      toast.error(t("Select a range with at least one complete day.", "Izaberi opseg sa bar jednim kompletnim danom."));
      return;
    }
    setGenLoading(true);
    setPost(null);
    try {
      const r = await genReport({ data: { metrics, news: news.data?.items ?? [] } });
      setReport(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenLoading(false);
    }
  };

  const onCreatePost = async () => {
    if (!report || !metrics) return;
    setPostLoading(true);
    try {
      const p = await genPost({ data: { report, metrics } });
      setPost(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPostLoading(false);
    }
  };

  const copyPost = async () => {
    if (!post) return;
    await navigator.clipboard.writeText(post.post);
    toast.success(t("Post copied to clipboard", "Tekst kopiran u klipbord"));
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const exportPng = async (variant: "square" | "wide") => {
    if (!cardRef.current) return;
    cardRef.current.dataset.variant = variant;
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `cea-weekly-${range?.from.toISOString().slice(0, 10)}-${variant}.png`;
      a.click();
    } catch (e) {
      toast.error(t("Export failed", "Izvoz nije uspeo") + ": " + String(e));
    }
  };

  return (
    <div className="space-y-6">
      <DateRangeControl firstAvailable={firstAvailable} latestAvailable={latestAvailable} />

      <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">
              {t("Weekly Market Intelligence", "Nedeljna tržišna analiza")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              {t(
                "AI-generated market summary for the selected period, plus a ready-to-post LinkedIn update with PNG export.",
                "AI generisan rezime tržišta za izabrani period, plus gotov LinkedIn post sa PNG izvozom.",
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={onGenerate} disabled={genLoading || !metrics}>
              {genLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {t("Generate Weekly Market Update", "Generiši nedeljni izveštaj")}
            </Button>
            <Button onClick={onCreatePost} disabled={postLoading || !report} variant="outline">
              {postLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Linkedin className="mr-2 h-4 w-4" />}
              {t("Create LinkedIn Post", "Kreiraj LinkedIn post")}
            </Button>
          </div>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <MiniKpi label={t("Baseload", "Baseload")} value={`${metrics.baseload} EUR/MWh`} delta={metrics.baseloadPrev != null ? metrics.baseload - metrics.baseloadPrev : undefined} />
          <MiniKpi label={t("Peakload", "Peakload")} value={metrics.peakload != null ? `${metrics.peakload} EUR/MWh` : "—"} />
          <MiniKpi label={t("Negative hrs", "Neg. sati")} value={String(metrics.negHours)} />
          <MiniKpi label={t("Volatility σ", "Volatilnost σ")} value={`${metrics.volatility} EUR/MWh`} />
        </div>
      )}

      {report && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ReportCard title={t("Headline", "Naslov")} body={<p className="text-lg font-medium">{report.headline}</p>} />
          <ReportCard title={t("Takeaway for RES producers", "Zaključak za OIE proizvođače")} body={<p>{report.takeaway}</p>} />
          <ReportCard title={t("A. Price moves", "A. Cenovni signali")} body={<BulletList items={report.priceMoves} />} />
          <ReportCard title={t("B. RES capture analysis", "B. Analiza capture cena OIE")} body={<BulletList items={report.resAnalysis} />} />
          <ReportCard title={t("C. Market signals", "C. Tržišni signali")} body={<BulletList items={report.marketSignals} />} />
          <ReportCard
            title={t("D. Energy news (last 7 days)", "D. Energetske vesti (7 dana)")}
            body={
              <ul className="space-y-3">
                {report.news.map((n) => (
                  <li key={n.url} className="border-l-2 border-primary/40 pl-3">
                    <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {n.title}
                    </a>
                    <div className="text-xs text-muted-foreground">{n.source} · {n.date}</div>
                    <div className="text-xs mt-1 italic">{n.whyItMatters}</div>
                  </li>
                ))}
              </ul>
            }
          />
        </div>
      )}

      {post && (
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl">{t("LinkedIn post", "LinkedIn post")}</h3>
            <Button size="sm" variant="outline" onClick={copyPost}>
              <Copy className="mr-2 h-4 w-4" />
              {t("Copy to clipboard", "Kopiraj")}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/30 p-4 text-sm leading-relaxed font-sans">
            {post.post}
          </pre>
          <p className="text-xs text-muted-foreground">{post.post.length} characters</p>
        </div>
      )}

      {report && metrics && (
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-display text-xl">{t("LinkedIn visual", "LinkedIn vizuelni post")}</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => exportPng("square")}>
                <Download className="mr-2 h-4 w-4" /> 1200×1200
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportPng("wide")}>
                <Download className="mr-2 h-4 w-4" /> 1200×627
              </Button>
            </div>
          </div>
          <div className="overflow-auto">
            <LinkedInCard ref={cardRef} metrics={metrics} report={report} weekLabel={metrics.weekLabel} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniKpi({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
      {delta != null && isFinite(delta) && (
        <div className={`text-xs ${delta > 0 ? "text-critical" : delta < 0 ? "text-positive" : "text-muted-foreground"}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {Math.abs(delta).toFixed(2)} vs prev week
        </div>
      )}
    </div>
  );
}

function ReportCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-card">
      <h3 className="font-display text-lg mb-3">{title}</h3>
      <div className="text-sm space-y-2 leading-relaxed">{body}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i, idx) => (
        <li key={idx} className="flex gap-2">
          <span className="text-primary mt-1">▸</span>
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

const LinkedInCard = ({
  ref,
  metrics,
  report,
  weekLabel,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  metrics: WeeklyMetrics;
  report: WeeklyReport;
  weekLabel: string;
}) => {
  return (
    <div
      ref={ref}
      data-variant="square"
      className="data-[variant=square]:w-[1200px] data-[variant=square]:h-[1200px] data-[variant=wide]:w-[1200px] data-[variant=wide]:h-[627px] bg-card border border-border p-16 flex flex-col justify-between shadow-card"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div>
        <div className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-widest text-muted-foreground">CEA Power Dashboard</div>
          <div className="text-sm text-muted-foreground">{weekLabel}</div>
        </div>
        <h1 className="mt-8 font-display text-5xl leading-tight text-foreground">
          {report.headline}
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <CardKpi label="Baseload" value={`${metrics.baseload}`} unit="EUR/MWh" />
        <CardKpi label="Peakload" value={metrics.peakload != null ? `${metrics.peakload}` : "—"} unit="EUR/MWh" />
        <CardKpi label="Neg. hours" value={String(metrics.negHours)} unit="hours" accent />
      </div>

      <div>
        <p className="text-xl leading-relaxed text-foreground">
          {report.takeaway}
        </p>
        <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground border-t border-border pt-4">
          <span>Source: ENTSO-E DA · Serbia SEEPEX · Europe/Belgrade</span>
          <span>ceadash.lovable.app</span>
        </div>
      </div>
    </div>
  );
};

function CardKpi({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-6 ${accent ? "bg-primary/10 border border-primary/30" : "bg-muted/40 border border-border"}`}>
      <div className="text-sm uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-5xl text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{unit}</div>
    </div>
  );
}
