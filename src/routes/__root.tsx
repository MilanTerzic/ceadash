import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider, LanguageToggle, useLang } from "@/lib/i18n";
import ceaLogo from "@/assets/cea-logo.png.asset.json";

function NotFoundComponent() {
  const { t } = useLang();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <h2 className="mt-4 text-xl text-foreground">
          {t("Page not found", "Stranica nije pronađena")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("The page you're looking for doesn't exist.", "Stranica koju tražite ne postoji.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Back to dashboard", "Nazad na dashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useLang();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-foreground">
          {t("Something went wrong", "Došlo je do greške")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Try again", "Pokušaj ponovo")}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Analytical tool by Centar za energetske analize (CEA) tracking renewable energy market signals, capture prices and project economics in Serbia.",
      },
      { name: "author", content: "Centar za energetske analize — CEA" },
      { property: "og:site_name", content: "CEA Power Dashboard" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Fira+Sans:wght@400;500;600;700&display=swap",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://dashboard.cea.org.rs/#organization",
              name: "Centar za energetske analize",
              alternateName: "CEA",
              url: "https://www.cea.org.rs/",
            },
            {
              "@type": "WebSite",
              "@id": "https://dashboard.cea.org.rs/#website",
              name: "CEA Power Dashboard",
              url: "https://dashboard.cea.org.rs/",
              publisher: { "@id": "https://dashboard.cea.org.rs/#organization" },
            },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function SiteHeader() {
  const { t } = useLang();
  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <img
            src={ceaLogo.url}
            alt="CEA — Center for Energy Analysis"
            className="h-9 w-9 object-contain"
          />

          <div className="leading-tight">
            <div className="font-display text-lg text-foreground">CEA</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("Centar za energetske analize", "Centar za energetske analize")}
            </div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">
            {t("About CEA", "O CEA")}
          </a>
          <Link to="/" className="hover:text-foreground">
            {t("Dashboard", "Dashboard")}
          </Link>
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">
            {t("Projects", "Projekti")}
          </a>
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">
            {t("News", "Vesti")}
          </a>
        </nav>
        <LanguageToggle />
      </div>
    </header>
  );
}

function SiteFooter() {
  const { t } = useLang();
  return (
    <footer className="mt-20 border-t border-border/60 bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-10 grid gap-6 md:grid-cols-3 text-sm">
        <div>
          <div className="font-display text-lg text-foreground">CEA Power Dashboard</div>
          <p className="mt-2 text-muted-foreground max-w-sm">
            {t(
              "An analytical tool by Centar za energetske analize tracking renewable energy market signals, capture prices and project economics in Serbia.",
              "Analitički alat Centra za energetske analize za praćenje signala tržišta obnovljivih izvora energije, capture cena i ekonomike projekata u Srbiji.",
            )}
          </p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("Data sources", "Izvori podataka")}
          </div>
          <ul className="mt-2 space-y-1 text-foreground/80">
            <li>ENTSO-E Transparency Platform</li>
            <li>{t("SEEPEX day-ahead market", "SEEPEX day-ahead tržište")}</li>
            <li>PVGIS (JRC, European Commission)</li>
            <li>AERS, EMS, Energy Community</li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("Disclaimer", "Napomena")}
          </div>
          <p className="mt-2 text-muted-foreground">
            {t(
              "This tool provides indicative analysis only and should not be interpreted as financial or investment advice.",
              "Ovaj alat pruža samo indikativnu analizu i ne treba ga tumačiti kao finansijski ili investicioni savet.",
            )}
          </p>
        </div>
      </div>
      <div className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Centar za energetske analize — CEA
      </div>
    </footer>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <div className="min-h-screen flex flex-col">
          <SiteHeader />
          <main className="flex-1">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
        <Toaster position="top-right" richColors />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
