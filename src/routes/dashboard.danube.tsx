import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/danube")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/outages", search, "hydrology"),
});
