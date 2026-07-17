import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/more", search: { tab: "settings" } });
  },
});
