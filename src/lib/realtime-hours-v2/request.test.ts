import assert from "node:assert/strict";
import test from "node:test";

import { dateWithinWindow, parseJsonText, readRequestTextWithLimit } from "./request";

test("reads a request body within the configured limit", async () => {
  const request = new Request("https://example.test", { method: "POST", body: "{\"ok\":true}" });
  const result = await readRequestTextWithLimit(request, 1024);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.text, "{\"ok\":true}");
});

test("rejects an oversized body", async () => {
  const request = new Request("https://example.test", { method: "POST", body: "x".repeat(100) });
  const result = await readRequestTextWithLimit(request, 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test("parses JSON without accepting invalid input", () => {
  assert.equal(parseJsonText("{\"ok\":true}").ok, true);
  assert.equal(parseJsonText("{").ok, false);
});

test("validates date windows", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assert.equal(dateWithinWindow("2026-10-28T12:04:00Z", { futureMs: 5 * 60_000, pastMs: 60_000 }, now), true);
  assert.equal(dateWithinWindow("2026-10-28T12:06:00Z", { futureMs: 5 * 60_000, pastMs: 60_000 }, now), false);
});
