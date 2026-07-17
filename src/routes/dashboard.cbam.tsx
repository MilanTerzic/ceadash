import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/cbam")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/portfolio", search: { view: "project" } });
  },
});
