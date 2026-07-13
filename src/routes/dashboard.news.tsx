import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEkapijaNews } from "@/lib/news.functions";
import { ChartCard, DemoBadge } from "@/components/dashboard/atoms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";


export const Route = createFileRoute("/dashboard/news")({
  head: () => ({
    meta: [
      { title: "News & Policy Monitor — CEA Power Dashboard" },
      { name: "description", content: "Curated Serbian and regional renewable energy news, policy and market updates." },
      { property: "og:title", content: "News & Policy Monitor — CEA Power Dashboard" },
      { property: "og:description", content: "Curated Serbian and regional renewable energy news, policy and market updates." },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/news" },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/news" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "News & Policy Monitor",
          url: "https://dashboard.cea.org.rs/dashboard/news",
          about: "Serbian and regional renewable energy news, policy and market updates.",
        }),
      },
    ],
  }),
  component: NewsPage,
});

type NewsItem = {
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

const DEMO_ITEMS: NewsItem[] = [
  {
    id: "d1",
    date: "2026-06-01",
    source: "SEEPEX",
    title: "Negative prices recorded on SEEPEX day-ahead market",
    original_url: "https://seepex-spot.rs",
    summary_en: "SEEPEX reported negative clearing prices during midday hours, the first time in Serbia. Market participants warn of growing curtailment risk for merchant solar.",
    ai_generated: true,
    region: "Serbia",
    category: "Market",
    tags: ["SEEPEX", "Solar", "Prices"],
  },
  {
    id: "d2",
    date: "2026-05-22",
    source: "Ministry of Mining and Energy",
    title: "New RES auction framework published for public consultation",
    original_url: "https://mre.gov.rs",
    summary_en: "Draft secondary legislation outlines volume caps, indexation rules and offtake structure for the upcoming auction round.",
    ai_generated: true,
    region: "Serbia",
    category: "Regulation",
    tags: ["Auctions", "Solar", "Wind", "Regulation"],
  },
  {
    id: "d3",
    date: "2026-05-15",
    source: "Balkan Green Energy News",
    title: "First aggregator licences expected in Q3 2026",
    original_url: "https://balkangreenenergynews.com",
    summary_en: "Aggregators are expected to begin operations later this year, opening up flexibility markets for distributed RES and prosumers.",
    ai_generated: true,
    region: "Region",
    category: "Market",
    tags: ["Aggregators", "Prosumers"],
  },
];

function NewsPage() {
  const [dbItems, setDbItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [user, setUser] = useState<{ id: string } | null>(null);
  const fetchEkapija = useServerFn(getEkapijaNews);
  const { data: ekapija } = useQuery({
    queryKey: ["ekapija-news"],
    queryFn: () => fetchEkapija(),
    staleTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id } : null));
    supabase
      .from("news_items")
      .select("*")
      .order("date", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setDbItems((data && data.length ? (data as NewsItem[]) : []));
        setLoading(false);
      });
  }, []);

  const merged: NewsItem[] = (() => {
    const ek = (ekapija?.items ?? []) as NewsItem[];
    const base = dbItems.length ? dbItems : DEMO_ITEMS;
    const seen = new Set(ek.map((i) => i.original_url));
    const combined = [...ek, ...base.filter((i) => !seen.has(i.original_url))];
    return combined.sort((a, b) => (a.date < b.date ? 1 : -1));
  })();

  const filtered = merged.filter(
    (i) =>
      (region === "all" || i.region === region) &&
      (category === "all" || i.category === category),
  );

  const usingDemo = dbItems.length === 0 && (ekapija?.items?.length ?? 0) === 0;

  return (
    <ChartCard
      title="News & Policy Monitor"
      description="Curated renewable energy news for Serbia and the region, including live summaries from eKapija."
      right={
        <Sheet>
          <SheetTrigger asChild>
            <Button size="sm" variant="secondary" disabled={!user}>
              {user ? "Add news item" : "Sign in to add"}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Add news item</SheetTitle>
            </SheetHeader>
            <AddNewsForm userId={user?.id} onAdded={(it) => setDbItems((p) => [it, ...p])} />
          </SheetContent>
        </Sheet>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 mb-4">
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            <SelectItem value="Serbia">Serbia</SelectItem>
            <SelectItem value="Region">Region</SelectItem>
            <SelectItem value="EU">EU</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="Market">Market</SelectItem>
            <SelectItem value="Regulation">Regulation</SelectItem>
            <SelectItem value="Investment">Investment</SelectItem>
            <SelectItem value="Technology">Technology</SelectItem>
          </SelectContent>
        </Select>
      </div>


      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {usingDemo && <DemoBadge />}
          {filtered.map((i) => (
            <article key={i.id} className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{i.date}</span>
                <span>·</span>
                <span className="font-medium text-foreground/80">{i.source}</span>
                <span>·</span>
                <Badge variant="outline">{i.region}</Badge>
                <Badge variant="outline">{i.category}</Badge>
                {i.ai_generated && <Badge className="bg-accent text-accent-foreground">AI summary</Badge>}
              </div>
              <h4 className="mt-1 font-display text-lg">
                <a href={i.original_url} target="_blank" rel="noreferrer" className="hover:underline">
                  {i.title}
                </a>
              </h4>
              {i.summary_en && <p className="mt-1 text-sm text-muted-foreground">{i.summary_en}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {i.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function AddNewsForm({ userId, onAdded }: { userId?: string; onAdded: (i: NewsItem) => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    source: "",
    title: "",
    original_url: "",
    summary_en: "",
    region: "Serbia",
    category: "Market",
    tags: "",
    ai_generated: false,
  });
  const submit = async () => {
    if (!userId) return;
    const payload = {
      ...form,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      created_by: userId,
    };
    const { data, error } = await supabase.from("news_items").insert(payload).select().single();
    if (error) {
      toast.error(error.message);
    } else if (data) {
      onAdded(data as NewsItem);
      toast.success("News item added");
    }
  };
  return (
    <div className="mt-4 space-y-3">
      {(["date", "source", "title", "original_url", "summary_en", "tags"] as const).map((k) => (
        <div key={k} className="space-y-1">
          <Label className="text-xs capitalize">{k.replace("_", " ")}</Label>
          {k === "summary_en" ? (
            <Textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          ) : (
            <Input value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          )}
        </div>
      ))}
      <Button onClick={submit} className="w-full">Add</Button>
    </div>
  );
}
