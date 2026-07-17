import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/weather")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/outlook" });
  },
});
