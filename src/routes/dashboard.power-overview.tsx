import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/power-overview")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard", search),
});
