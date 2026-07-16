import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/report")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/market-report" });
  },
});
