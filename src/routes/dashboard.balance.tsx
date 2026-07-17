import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/balance")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/system" });
  },
});
