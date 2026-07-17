import { createServerFn } from "@tanstack/react-start";

const SYSTEM = `You are an experienced power-market analyst writing for renewable-energy producers and investors in Serbia and the SEE region. Be concise, numerate, practical. Avoid hype. Always interpret what the data means for a RES producer.`;

async function callAI(messages: { role: string; content: string }[], json = true) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Please retry in a minute.");
  if (res.status === 402)
    throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  const json2 = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json2.choices?.[0]?.message?.content ?? "";
}

export type WeeklyMetrics = {
  weekLabel: string;
  baseload: number;
  baseloadPrev?: number;
  peakload: number | null;
  minHour: number;
  maxHour: number;
  negHours: number;
  lowHours: number;
  volatility: number;
  solarCapture?: number | null;
  windCapture?: number | null;
  eveningPeakAvg?: number | null;
  middayAvg?: number | null;
};

export type WeeklyNewsItem = {
  title: string;
  source: string;
  date: string;
  url: string;
  summary?: string | null;
};

export type WeeklyReport = {
  headline: string;
  priceMoves: string[];
  resAnalysis: string[];
  marketSignals: string[];
  news: { title: string; source: string; date: string; url: string; whyItMatters: string }[];
  takeaway: string;
};

export const generateWeeklyReport = createServerFn({ method: "POST" })
  .inputValidator((input: { metrics: WeeklyMetrics; news: WeeklyNewsItem[] }) => input)
  .handler(async ({ data }): Promise<WeeklyReport> => {
    const prompt = `Generate a weekly market intelligence report for RES producers in Serbia / SEE.

METRICS (Europe/Belgrade, SEEPEX-Serbia, EIC 10YCS-SERBIATSOV):
${JSON.stringify(data.metrics, null, 2)}

CANDIDATE NEWS (last 7 days, pre-filtered):
${JSON.stringify(data.news.slice(0, 12), null, 2)}

Return ONLY a JSON object matching this schema:
{
  "headline": "one strong sentence summarising the week",
  "priceMoves": ["3-5 bullet sentences with numbers about baseload, peakload, min/max, WoW delta"],
  "resAnalysis": ["3-4 bullets on solar/wind capture, capture vs baseload spread, what it means for producers"],
  "marketSignals": ["3-5 bullets on negative prices, volatility, evening peak, midday cannibalisation, curtailment risk"],
  "news": [{"title": "...", "source": "...", "date": "YYYY-MM-DD", "url": "...", "whyItMatters": "one sentence"}],
  "takeaway": "one paragraph practical takeaway for a RES producer"
}

Pick 4-6 most relevant news items. Do not invent prices, sources, or URLs.`;

    const text = await callAI([
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ]);
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as WeeklyReport;

    // Persist used news URLs to dedupe future runs
    if (parsed.news?.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const weekIso = new Date().toISOString().slice(0, 10);
      const rows = parsed.news
        .filter((n) => n.url)
        .map((n) => ({ url: n.url, title: n.title, week_iso: weekIso }));
      if (rows.length) {
        await supabaseAdmin.from("weekly_report_used_news").upsert(rows, { onConflict: "url" });
      }
    }
    return parsed;
  });

export const generateLinkedInPost = createServerFn({ method: "POST" })
  .inputValidator((input: { report: WeeklyReport; metrics: WeeklyMetrics }) => input)
  .handler(async ({ data }): Promise<{ post: string; hashtags: string[] }> => {
    const prompt = `Write a LinkedIn post (1200-1800 characters total, NOT counting hashtags) based on this weekly Serbia/SEE power market report.

Style: professional but conversational, visually structured with short lines and tasteful emoji bullets (▸ ⚡ 📉 📈 🌞 ⚠️ — not all of them, use 2-3 well). Focus on RES producers, investors, market participants. Different from a generic LinkedIn corporate post.

Structure:
1. Strong one-line opener.
2. Empty line, then 3-5 key insights with numbers (use the metrics).
3. Empty line, "What this means for RES producers:" + one sentence.
4. Empty line, "Chart idea:" + one short visual suggestion.
5. Empty line, 3-5 relevant hashtags on a single last line.

METRICS:
${JSON.stringify(data.metrics, null, 2)}

REPORT:
${JSON.stringify(data.report, null, 2)}

Return ONLY a JSON object:
{ "post": "the full post text including hashtags on the last line", "hashtags": ["#tag1", "#tag2"] }`;

    const text = await callAI([
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ]);
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned) as { post: string; hashtags: string[] };
  });

export const fetchRecentNewsForWeekly = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const [{ data: news }, { data: used }] = await Promise.all([
    supabaseAdmin
      .from("news_items")
      .select("title, source, date, original_url, summary_en, tags, region, category")
      .gte("date", sevenDaysAgo)
      .order("date", { ascending: false })
      .limit(40),
    supabaseAdmin.from("weekly_report_used_news").select("url"),
  ]);

  type UsedNewsRow = { url: string | null };
  type NewsRow = {
    title: string | null;
    source: string | null;
    date: string | null;
    original_url: string | null;
    summary_en: string | null;
  };

  const usedSet = new Set((used ?? []).map((r: UsedNewsRow) => r.url).filter(Boolean));
  const items = (news ?? [])
    .map((n) => n as NewsRow)
    .filter((n) => n.original_url && !usedSet.has(n.original_url))
    .map((n) => ({
      title: n.title ?? "",
      source: n.source ?? "",
      date: n.date ?? "",
      url: n.original_url ?? "",
      summary: n.summary_en ?? null,
    }));
  return { items };
});
