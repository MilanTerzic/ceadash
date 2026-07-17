import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/flexibility")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/portfolio", search: { view: "vpp" } });
  },
});
