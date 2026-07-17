import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/cbc")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/market-report", search),
});
