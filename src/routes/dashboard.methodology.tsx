import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/methodology")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/more", search: { tab: "methodology" } });
  },
});
