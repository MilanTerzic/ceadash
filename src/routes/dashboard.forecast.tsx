import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/forecast")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/outlook" });
  },
});
