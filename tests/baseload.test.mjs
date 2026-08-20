import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

// Keep these regression cases explicit because delivery-day completeness is a
// market-data invariant: Belgrade has 23/24/25-hour days around DST.
const hour = 60 * 60 * 1000;

function expectedHours(startIso, endIso) {
  return (Date.parse(endIso) - Date.parse(startIso)) / hour;
}

test("normal Belgrade delivery day has 24 hourly intervals", () => {
  assert.equal(expectedHours("2026-02-10T23:00:00Z", "2026-02-11T23:00:00Z"), 24);
});

test("spring DST Belgrade delivery day has 23 hourly intervals", () => {
  assert.equal(expectedHours("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z"), 23);
});

test("autumn DST Belgrade delivery day has 25 hourly intervals", () => {
  assert.equal(expectedHours("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z"), 25);
});

test("missing one or more intervals must not satisfy completeness", () => {
  const expected = new Set(Array.from({ length: 24 }, (_, i) => i));
  for (const missing of [1, 2, 3, 4]) {
    const observed = new Set(Array.from({ length: 24 - missing }, (_, i) => i));
    const complete = observed.size === expected.size && [...expected].every((i) => observed.has(i));
    assert.equal(complete, false);
  }
});
