import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/spreads")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/prices", search, "spreads"),
});
