import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://ceadash.lovable.app";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const ENTRIES: SitemapEntry[] = [
  { path: "/dashboard", changefreq: "daily", priority: "1.0" },
  { path: "/dashboard/market", changefreq: "daily", priority: "0.9" },
  { path: "/dashboard/capture", changefreq: "daily", priority: "0.9" },
  { path: "/dashboard/regional", changefreq: "daily", priority: "0.9" },
  { path: "/dashboard/insights", changefreq: "weekly", priority: "0.7" },
  { path: "/dashboard/calculator", changefreq: "monthly", priority: "0.8" },
  { path: "/dashboard/news", changefreq: "daily", priority: "0.8" },
  { path: "/dashboard/methodology", changefreq: "monthly", priority: "0.5" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ENTRIES.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
