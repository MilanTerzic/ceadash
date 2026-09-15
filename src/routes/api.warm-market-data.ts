import { createFileRoute } from "@tanstack/react-router";

import { authorizeAutomationRequest } from "@/lib/automation-auth.server";
import {
  runIngestionPipeline,
  type IngestionMode,
  type IngestionPipeline,
} from "@/lib/market-ingestion.server";

const PIPELINES: IngestionPipeline[] = ["prices", "flows", "capacity", "fundamentals"];

function parseMode(value: string | null): IngestionMode {
  return value === "history" ? "history" : "tail";
}

function parsePipelines(value: string | null): IngestionPipeline[] {
  if (!value || value === "all") return PIPELINES;
  return PIPELINES.includes(value as IngestionPipeline) ? [value as IngestionPipeline] : [];
}

export const Route = createFileRoute("/api/warm-market-data")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAutomationRequest(request);
        if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

        const url = new URL(request.url);
        const mode = parseMode(url.searchParams.get("mode"));
        const pipelines = parsePipelines(url.searchParams.get("pipeline"));
        if (!pipelines.length) {
          return Response.json(
            { ok: false, error: "invalid_pipeline", allowed: ["all", ...PIPELINES] },
            { status: 400 },
          );
        }

        const startedAt = Date.now();
        const results = [];
        for (const pipeline of pipelines) {
          try {
            results.push(await runIngestionPipeline(pipeline, mode));
          } catch (error) {
            results.push({
              pipeline,
              ok: false,
              succeeded: 0,
              failed: 1,
              rowsWritten: 0,
              errors: [error instanceof Error ? error.message : String(error)],
              elapsedMs: 0,
            });
          }
        }

        const succeededPipelines = results.filter((result) => result.ok).length;
        const body = {
          ok: succeededPipelines > 0,
          allOk: succeededPipelines === results.length,
          mode,
          pipelines: results.length,
          succeededPipelines,
          failedPipelines: results.length - succeededPipelines,
          rowsWritten: results.reduce((sum, result) => sum + result.rowsWritten, 0),
          results,
          elapsedMs: Date.now() - startedAt,
          generatedAt: new Date().toISOString(),
        };

        return Response.json(body, { status: body.ok ? 200 : 503 });
      },
    },
  },
});
