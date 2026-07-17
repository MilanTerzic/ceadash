import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/capacity")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/flows", search, "capacity"),
});
