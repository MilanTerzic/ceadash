import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/wb6")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/markets/system" });
  },
});
