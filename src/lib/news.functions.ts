import { createServerFn } from "@tanstack/react-start";

export type EkapijaItem = {
  id: string;
  date: string;
  source: string;
  title: string;
  original_url: string;
  summary_en: string | null;
  ai_generated: boolean;
  region: string;
  category: string;
  tags: string[];
};

type CacheEntry = { ts: number; data: EkapijaItem[] };
const CACHE: { current?: CacheEntry } = {};
const TTL_MS = 30 * 60 * 1000;

function parseSerbianDate(s: string): string {
  // "10.06.2026." -> "2026-06-10"
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEkapija(html: string): EkapijaItem[] {
  const items: EkapijaItem[] = [];
  const seen = new Set<string>();
  // Match anchor blocks containing a dateCat paragraph + title paragraph
  const re =
    /<a\s+href="(https:\/\/www\.ekapija\.com\/news\/\d+\/[^"]+)"[^>]*>[\s\S]*?<p class="dateCat[^"]*">([^<]+)<\/p>\s*<p>([^<]+)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const dateCat = decode(m[2]);
    const title = decode(m[3]);
    const [datePart, catPart = ""] = dateCat.split("|").map((x) => x.trim());
    const cats = catPart
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    items.push({
      id: url,
      date: parseSerbianDate(datePart),
      source: "eKapija",
      title,
      original_url: url,
      summary_en: null,
      ai_generated: false,
      region: "Serbia",
      category: "Market",
      tags: cats.length ? cats : ["Energija"],
    });
    if (items.length >= 20) break;
  }
  return items;
}

async function translateTitles(items: EkapijaItem[]): Promise<EkapijaItem[]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || items.length === 0) return items;
  try {
    const prompt =
      "Translate each Serbian news headline to a concise English summary (max 22 words). Return ONLY a JSON array of strings in the same order, no prose.\n\n" +
      JSON.stringify(items.map((i) => i.title));
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You translate Serbian energy news headlines to English." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return items;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const txt = json.choices?.[0]?.message?.content ?? "";
    const match = txt.match(/\[[\s\S]*\]/);
    if (!match) return items;
    const arr = JSON.parse(match[0]) as string[];
    return items.map((it, idx) => ({
      ...it,
      summary_en: arr[idx] ?? null,
      ai_generated: Boolean(arr[idx]),
    }));
  } catch {
    return items;
  }
}

export const getEkapijaNews = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (CACHE.current && now - CACHE.current.ts < TTL_MS) {
    return { items: CACHE.current.data };
  }
  try {
    const res = await fetch("https://www.ekapija.com/news/energija", {
      headers: { "User-Agent": "Mozilla/5.0 (CEA Dashboard)" },
    });
    if (!res.ok) return { items: [] as EkapijaItem[] };
    const html = await res.text();
    const parsed = parseEkapija(html);
    const withSummaries = await translateTitles(parsed);
    CACHE.current = { ts: now, data: withSummaries };
    return { items: withSummaries };
  } catch {
    return { items: [] as EkapijaItem[] };
  }
});
