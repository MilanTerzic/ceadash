import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/settings")({
  beforeLoad: ({ search }) =>
    legacyDashboardRedirect("/dashboard/methodology", search, "data-status"),
});
