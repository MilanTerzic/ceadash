export type CapacityAuctionSemantic =
  | "requested_capacity"
  | "allocated_capacity_with_price"
  | "unknown";

export type CapacityAuctionObservation = {
  semantic: CapacityAuctionSemantic;
  requestedMw: number | null;
  allocatedMw: number | null;
  auctionPriceEurPerMWh: number | null;
  executableCapacityMw: number | null;
};

/**
 * ENTSO-E explicit-allocation business types used by the dashboard.
 *
 * A25 allocation-result data describes an auction outcome. Public requested or
 * allocated MW must never be interpreted as capacity executable by the current
 * dashboard user. Executable capacity has to come from a separate verified
 * source such as a user-owned position or a remaining-capacity publication.
 */
export function explicitAllocationSemantic(businessType: string): CapacityAuctionSemantic {
  if (businessType === "A43") return "requested_capacity";
  if (businessType === "B05") return "allocated_capacity_with_price";
  return "unknown";
}

export function capacityAuctionObservation(args: {
  businessType: string;
  quantityMw: number | null | undefined;
  priceEurPerMWh?: number | null;
}): CapacityAuctionObservation {
  const semantic = explicitAllocationSemantic(args.businessType);
  const quantity = finiteOrNull(args.quantityMw);
  const price = finiteOrNull(args.priceEurPerMWh);
  return {
    semantic,
    requestedMw: semantic === "requested_capacity" ? quantity : null,
    allocatedMw: semantic === "allocated_capacity_with_price" ? quantity : null,
    auctionPriceEurPerMWh: semantic === "allocated_capacity_with_price" ? price : null,
    executableCapacityMw: null,
  };
}

export function mergeCapacityAuctionObservations(
  observations: CapacityAuctionObservation[],
): CapacityAuctionObservation {
  let requestedMw: number | null = null;
  let allocatedMw: number | null = null;
  let auctionPriceEurPerMWh: number | null = null;
  for (const observation of observations) {
    if (observation.requestedMw != null) requestedMw = observation.requestedMw;
    if (observation.allocatedMw != null) allocatedMw = observation.allocatedMw;
    if (observation.auctionPriceEurPerMWh != null) {
      auctionPriceEurPerMWh = observation.auctionPriceEurPerMWh;
    }
  }
  return {
    semantic: "unknown",
    requestedMw,
    allocatedMw,
    auctionPriceEurPerMWh,
    executableCapacityMw: null,
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
