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

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <h2 className="mt-4 text-xl text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
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
      { property: "og:title", content: "CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "Renewable energy market analytics for Serbia: SEEPEX prices, capture prices, solar project economics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "CEA Power Dashboard" },
      { name: "description", content: "CEA Power Dashboard provides insights into the Serbian electricity market for renewable energy stakeholders." },
      { property: "og:description", content: "CEA Power Dashboard provides insights into the Serbian electricity market for renewable energy stakeholders." },
      { name: "twitter:description", content: "CEA Power Dashboard provides insights into the Serbian electricity market for renewable energy stakeholders." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e13c113f-4ade-4017-ac14-75e917642739/id-preview-362c8451--b25719ce-1fa7-48cd-a27e-36a18a4404cd.lovable.app-1781097895539.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e13c113f-4ade-4017-ac14-75e917642739/id-preview-362c8451--b25719ce-1fa7-48cd-a27e-36a18a4404cd.lovable.app-1781097895539.png" },
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
  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-lg">
            C
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg text-foreground">CEA</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Centar za energetske analize
            </div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">About CEA</a>
          <Link to="/" className="hover:text-foreground">Dashboard</Link>
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">Projects</a>
          <a href="https://www.cea.org.rs/" className="hover:text-foreground">News</a>
        </nav>
        <div className="text-xs text-muted-foreground hidden sm:block">EN</div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border/60 bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-10 grid gap-6 md:grid-cols-3 text-sm">
        <div>
          <div className="font-display text-lg text-foreground">CEA Power Dashboard</div>
          <p className="mt-2 text-muted-foreground max-w-sm">
            An analytical tool by Centar za energetske analize tracking renewable energy market
            signals, capture prices and project economics in Serbia.
          </p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Data sources</div>
          <ul className="mt-2 space-y-1 text-foreground/80">
            <li>ENTSO-E Transparency Platform</li>
            <li>SEEPEX day-ahead market</li>
            <li>PVGIS (JRC, European Commission)</li>
            <li>AERS, EMS, Energy Community</li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Disclaimer</div>
          <p className="mt-2 text-muted-foreground">
            This tool provides indicative analysis only and should not be interpreted as financial
            or investment advice.
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
      <div className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
