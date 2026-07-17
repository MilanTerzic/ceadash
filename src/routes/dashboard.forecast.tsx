import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/forecast")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/futures", search, "forecast"),
});
