import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/market")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/balance", search, "serbia"),
});
