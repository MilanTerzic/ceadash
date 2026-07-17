import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/weekly")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/reports" });
  },
});
