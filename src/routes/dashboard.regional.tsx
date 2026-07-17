import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/regional")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/spot" });
  },
});
