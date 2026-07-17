import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/futures")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/outlook" });
  },
});
