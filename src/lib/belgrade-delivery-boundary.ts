/**
 * UTC instant corresponding to 00:00 Europe/Belgrade on the delivery date.
 *
 * Determine the offset at UTC midnight, not UTC noon. DST changes in Serbia
 * occur at 01:00 UTC; using the noon offset shifts the first delivery hour
 * on spring/autumn transition days.
 */
export function belgradeDeliveryStartUtc(dayISO: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) throw new Error("invalid_delivery_date");
  const utcMidnight = new Date(`${dayISO}T00:00:00Z`);
  if (
    !Number.isFinite(utcMidnight.getTime()) ||
    utcMidnight.toISOString().slice(0, 10) !== dayISO
  ) {
    throw new Error("invalid_delivery_date");
  }
  const zonePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    timeZoneName: "shortOffset",
  })
    .formatToParts(utcMidnight)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zonePart ?? "");
  if (!match) throw new Error("unrecognised_belgrade_utc_offset");
  const sign = match[1] === "+" ? 1 : -1;
  const offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000);
}
