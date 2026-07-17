import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/spreads")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/spot" });
  },
});
