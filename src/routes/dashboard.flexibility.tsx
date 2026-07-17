import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/flexibility")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/capture", search, "flexibility"),
});
