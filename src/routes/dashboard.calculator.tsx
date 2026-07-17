import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/calculator")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/portfolio", search: { view: "project" } });
  },
});
