import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/flows")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/system" });
  },
});
