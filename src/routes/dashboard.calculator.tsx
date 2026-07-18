import { createFileRoute } from "@tanstack/react-router";

import { ProjectEconomicsWorkspace } from "@/components/project-economics/ProjectEconomicsWorkspace";
import type { AssetType } from "@/lib/project-economics/types";

export const Route = createFileRoute("/dashboard/calculator")({
  head: () => ({
    meta: [
      { title: "Multi-Asset Project Economics - CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Indicative solar, wind, BESS and hybrid project economics with transparent futures-anchored hourly price scenarios.",
      },
      { property: "og:title", content: "Multi-Asset Project Economics - CEA Power Dashboard" },
      {
        property: "og:description",
        content:
          "Model solar, wind, battery storage and hybrid renewable projects in one coherent workspace.",
      },
      { property: "og:url", content: "https://dashboard.cea.org.rs/dashboard/calculator" },
    ],
    links: [{ rel: "canonical", href: "https://dashboard.cea.org.rs/dashboard/calculator" }],
  }),
  component: CalculatorPage,
});

function CalculatorPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const asset: AssetType =
    search.asset === "wind" || search.asset === "bess" || search.asset === "hybrid"
      ? search.asset
      : "solar";
  return (
    <ProjectEconomicsWorkspace
      asset={asset}
      onAssetChange={(nextAsset) =>
        navigate({
          search: (previous: Record<string, unknown>) => ({ ...previous, asset: nextAsset }),
          replace: true,
        })
      }
    />
  );
}
