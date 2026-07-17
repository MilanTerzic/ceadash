import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/map")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/flows", search, "map"),
});
