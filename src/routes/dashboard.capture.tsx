import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/capture")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/portfolio", search: { view: "producer" } });
  },
});
