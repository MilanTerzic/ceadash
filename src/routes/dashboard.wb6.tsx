import { createFileRoute } from "@tanstack/react-router";
import { legacyDashboardRedirect } from "@/lib/dashboard-redirect";

export const Route = createFileRoute("/dashboard/wb6")({
  beforeLoad: ({ search }) => legacyDashboardRedirect("/dashboard/balance", search, "wb6"),
});
