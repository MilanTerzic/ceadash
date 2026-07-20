type SourceDiagnostic = {
  source: string;
  from: string;
  to: string;
  http_status?: number;
  content_type?: string;
  records: number;
  reason?: string;
};

export function logSourceDiagnostic(diagnostic: SourceDiagnostic): void {
  if (process.env.NODE_ENV === "production") return;
  console.info(
    JSON.stringify({
      event: "fundamentals_source_fetch",
      ...diagnostic,
      reason: diagnostic.reason ?? null,
    }),
  );
}
