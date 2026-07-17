import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/news")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/reports", search: { tab: "news" } });
  },
});
