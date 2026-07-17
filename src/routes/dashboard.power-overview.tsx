import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/power-overview")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
