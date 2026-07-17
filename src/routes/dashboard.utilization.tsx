import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/utilization")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/system" });
  },
});
