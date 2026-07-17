import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/capacity")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/system" });
  },
});
