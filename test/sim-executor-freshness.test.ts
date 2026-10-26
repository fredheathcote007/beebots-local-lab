import { describe, expect, it } from "vitest";
import { SimExecutor } from "../src/exec/executor.js";
import type { Instrument, Ticker } from "../src/market/types.js";

const now = 1_800_000_000_000;
const a = "BTC-USD_XPERP";
const b = "ETH-USD_XPERP";
const instrument = (instId: string): Instrument => ({ instId, coin: instId.slice(0, 3), kind: "crypto", ctVal: 1, lotSz: 1, minSz: 1, tickSz: 0.1, state: "live" });
const ticker = (instId: string, ts: number, over: Partial<Ticker> = {}): Ticker => ({ instId, ts, last: 100, bid: 99, ask: 101, mid: 100, spreadBp: 200, vol24hUsd: 1_000_000, open24h: 100, ...over });
const req = (instId: string, reduceOnly = false) => ({ instId, side: "sell" as const, contracts: 1, reduceOnly, clOrdId: "test" });

describe("SimExecutor quote freshness", () => {
  it("rejects one stale instrument even when another instrument refreshed", async () => {
    const feed = { tickers: new Map([[a, ticker(a, now - 120_001)], [b, ticker(b, now)]]), instruments: new Map([[a, instrument(a)], [b, instrument(b)]]) };
    const sim = new SimExecutor(() => feed, 0, () => now);
    expect(await sim.market("bee1", req(a))).toMatchObject({ ok: false, state: "rejected" });
    expect(await sim.market("bee1", req(a, true))).toMatchObject({ ok: false, state: "rejected" });
    expect(await sim.market("bee1", req(b))).toMatchObject({ ok: true, avgPx: 99 });
  });

  it.each([
    ["missing timestamp", Number.NaN, {}],
    ["future timestamp", now + 30_001, {}],
    ["invalid bid", now, { bid: 0 }],
    ["invalid ask", now, { ask: Number.NaN }],
    ["invalid last", now, { last: -1 }],
    ["crossed book", now, { bid: 102, ask: 101 }],
  ])("rejects %s", async (_label, ts, over) => {
    const feed = { tickers: new Map([[a, ticker(a, ts, over)]]), instruments: new Map([[a, instrument(a)]]) };
    expect(await new SimExecutor(() => feed, 0, () => now).market("bee1", req(a))).toMatchObject({ ok: false, state: "rejected" });
  });
});
