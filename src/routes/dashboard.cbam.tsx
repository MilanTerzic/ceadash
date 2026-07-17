import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/cbam")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/calculator", search, "cbam"),
});
