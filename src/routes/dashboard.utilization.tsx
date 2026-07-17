import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/utilization")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/flows", search, "utilization"),
});
