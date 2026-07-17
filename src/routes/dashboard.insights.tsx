import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/insights")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/reports", search: { tab: "signals" } });
  },
});
