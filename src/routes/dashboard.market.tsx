import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/market")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/spot" });
  },
});
