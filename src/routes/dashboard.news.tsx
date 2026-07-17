import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/news")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/insights", search, "news"),
});
