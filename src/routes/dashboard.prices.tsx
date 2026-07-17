import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/prices")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/spot" });
  },
});
