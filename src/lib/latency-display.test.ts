import assert from "node:assert/strict";
import test from "node:test";
import { formatLatencyDisplay, latencyDisplayValue, latencyUnit } from "./latency-display";

test("ADS and Comments convert minutes to decimal hours exactly once", () => {
  for (const lob of ["ADS", "PROJECT", "COMMENTS", "tns_comments"]) {
    assert.equal(latencyUnit(lob), "h");
    assert.equal(latencyDisplayValue(150, lob), 2.5);
    assert.equal(formatLatencyDisplay(150, lob), "2,5 h");
  }
  assert.equal(formatLatencyDisplay(1440, "COMMENTS"), "24 h");
  assert.equal(formatLatencyDisplay(120, "ADS"), "2 h");
});
test("TNS video retains minutes; no data and true zero remain distinct", () => {
  for (const lob of ["TNS", "VIDEO"]) {
    assert.equal(latencyUnit(lob), "min");
    assert.equal(latencyDisplayValue(15, lob), 15);
    assert.equal(formatLatencyDisplay(15, lob), "15 min");
  }
  assert.equal(latencyDisplayValue(null, "ADS"), null);
  assert.equal(formatLatencyDisplay(undefined, "ADS"), "Sem dados");
  assert.equal(formatLatencyDisplay(0, "ADS"), "0 h");
});
