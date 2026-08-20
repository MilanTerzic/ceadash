# Cross-border capacity and route-economics audit

## P0: allocation data are being presented as available capacity

`fetchExplicitAllocation()` retrieves A25 allocation results and exposes fields named `offered_mw` and `allocated_mw`. Downstream `availableCapacity()` returns `allocated_mw` first and labels that value as `availableCapacityMw` in route opportunities.

This is not a safe interpretation. Total capacity allocated in an auction is not capacity currently available to the dashboard user or to a trader. It is an auction-result volume. Treating it as available capacity can materially overstate executable route size and potential margin.

The ENTSO-E Transparency Platform implementation guide maps A25 explicit allocation results to business types A43 (requested capacity) and B05 (capacity allocated with price). The current code separately requests business type A31 as `offered_mw`; A31 is an offered-capacity business type in capacity-document processes and is not the documented A25 explicit-allocation result mapping.

Required remediation:

1. Rename auction result fields to reflect their actual semantics, e.g. `requested_mw`, `allocated_mw`, `auction_price_eur_mwh`.
2. Do not label auction total allocated/requested quantities as `availableCapacityMw`.
3. If available/remaining transfer capacity is required, fetch the appropriate capacity publication/product and document whether it is ATC, offered capacity or another measure.
4. Route economics should report `margin per MW` independently of executable volume unless a user-owned capacity position or verified available capacity is supplied.
5. Validate documentType/businessType combinations against the current ENTSO-E Transparency Platform guide and add fixture tests.
6. Keep explicit warnings for long-term auction price units until the exact source/product semantics are verified.

## P1: simple averaging of auction points

`parseAllocationSummary()` takes an arithmetic mean of all `price.amount` and `quantity` points across all time series/periods. This can erase temporal structure and may not represent a valid auction marginal price or capacity volume if the document contains multiple periods, directions or products.

Required remediation:

- preserve period/timestamp structure;
- aggregate quantities with duration-aware semantics where appropriate;
- only report a single price when the source document defines one comparable price for the requested product;
- otherwise expose interval/period values and an explicitly documented derived statistic.
