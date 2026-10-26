import { describe, expect, it } from "vitest";
import { ALLOWED_SOCKET, EXPECTED_MODEL, fixture, parseArgs, percentile, summariseRows, validDistribution } from "../scripts/benchmark-decider-shadow.mjs";

describe("Decider benchmark validation", () => {
  it("uses nearest-rank percentiles without mutating the samples", () => {
    const values = [9, 1, 3, 7, 5];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(9);
    expect(percentile(values, 99)).toBe(9);
    expect(values).toEqual([9, 1, 3, 7, 5]);
    expect(percentile([], 50)).toBeNull();
    expect(percentile(values, 101)).toBeNull();
  });

  it("separates all-request SLA tails from accepted model latency", () => {
    const rows = [
      { status: "ok", modelAccepted: true, latencyMs: 110 },
      { status: "ok", modelAccepted: true, latencyMs: 140 },
      { status: "timeout", modelAccepted: false, latencyMs: 12000 },
      { status: "invalid_response", modelAccepted: true, latencyMs: 20 },
    ];
    expect(summariseRows(rows)).toMatchObject({
      ok: 2, modelAccepted: 3, timeouts: 1,
      statusCounts: { ok: 2, timeout: 1, invalid_response: 1 },
      p95Ms: 12000, p95OkMs: 140, p50OkMs: 110,
    });
    expect(summariseRows([]).p95OkMs).toBeNull();
  });

  it("accepts only complete, bounded distributions that sum to one", () => {
    const labels = ["WAIT", "BUY_BTC"];
    expect(validDistribution("WAIT", { WAIT: 0.75, BUY_BTC: 0.25 }, labels)).toBe(true);
    expect(validDistribution("SELL", { WAIT: 0.75, BUY_BTC: 0.25 }, labels)).toBe(false);
    expect(validDistribution("WAIT", { WAIT: 0.75, BUY_BTC: 0.2 }, labels)).toBe(false);
    expect(validDistribution("WAIT", { WAIT: 1.1, BUY_BTC: -0.1 }, labels)).toBe(false);
    expect(validDistribution("WAIT", { WAIT: 1, BUY_BTC: 0, EXTRA: 0 }, labels)).toBe(false);
  });

  it("bounds every CLI dimension and the optional socket destination", () => {
    expect(parseArgs(["--count", "10", "--concurrency", "3", "--samples", "30", "--timeout", "20000"])).toMatchObject({ count: 10, concurrency: 3, samples: 30, timeout: 20_000 });
    expect(parseArgs(["--fixture", "minimal"]).fixture).toBe("minimal");
    expect(parseArgs(["--socket", ALLOWED_SOCKET]).socket).toBe(ALLOWED_SOCKET);
    expect(() => parseArgs(["--count", "11"])).toThrow(/count must be 1\.\.10/);
    expect(() => parseArgs(["--concurrency", "4"])).toThrow(/concurrency must be 1\.\.3/);
    expect(() => parseArgs(["--timeout", "20001"])).toThrow(/timeout must be 1\.\.20000/);
    expect(() => parseArgs(["--samples", "31"])).toThrow(/samples must be 1\.\.30/);
    expect(() => parseArgs(["--fixture", "live"])).toThrow(/fixture must be/);
    expect(() => parseArgs(["--socket", "/tmp/other.sock"])).toThrow(/restricted/);
    expect(() => parseArgs(["--endpoint", "http://example.com"])).toThrow(/unknown flag/);
  });

  it("builds stable Engine-shaped synthetic requests with no execution action", () => {
    const first = fixture("bee-realistic", 0);
    expect(first).toEqual(fixture("bee-realistic", 0));
    expect(first.model).toBe(EXPECTED_MODEL);
    expect(first.questions).toMatchObject({ action: { type: "choice" }, conviction: { type: "score" } });
    expect(Object.keys(first.questions.action.criteria)).toEqual(["FADE_LONG_SOL", "WAIT", "FADE_SHORT_SUI"]);
    expect(fixture("bee-realistic", 3).state).toHaveProperty("coins.rows.SUI");
  });
});
