import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/market-report")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/reports" });
  },
});
