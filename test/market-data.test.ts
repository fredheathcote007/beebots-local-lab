import { describe, expect, it } from "vitest";
import { MarketFeed, MAX_TICKER_AGE_MS } from "../src/market/data.js";
import type { PublicApi } from "../src/okx/public.js";
import type { Instrument, Ticker } from "../src/market/types.js";

const NOW = 1_800_000_000_000;
const instrument: Instrument = { instId: "BTC-USD_UM_XPERP-310404", coin: "BTC", kind: "crypto", ctVal: 0.01, lotSz: 1, minSz: 1, tickSz: 0.1, state: "live" };
const ticker = (ts: number): Ticker => ({ instId: instrument.instId, last: 100, bid: 99.9, ask: 100.1, mid: 100, spreadBp: 20, vol24hUsd: 2_000_000, open24h: 99, ts });

describe("MarketFeed timestamp fallback", () => {
  it("accepts fresh public timestamps and preserves the last good snapshot when the source goes stale", async () => {
    let current = new Map([[instrument.instId, ticker(NOW)]]);
    const api = {
      instruments: async () => [instrument],
      tickers: async () => current,
      candles: async () => [],
      openInterest: async () => new Map(),
      funding: async () => ({ rate: 0, nextFundingTime: NOW }),
      fundingHistory: async () => [],
    } as unknown as PublicApi;
    const feed = new MarketFeed(api, { min24hVolUsd: 1, allowNonCrypto: false, spreadGateBps: 30, trendCoins: [] }, null, () => []);

    await feed.refresh(NOW);
    expect(feed.lastRefreshAt).toBe(NOW);
    expect(feed.view().tickers.get(instrument.instId)?.ts).toBe(NOW);

    current = new Map([[instrument.instId, ticker(NOW - MAX_TICKER_AGE_MS - 1)]]);
    await expect(feed.refreshTickers(NOW)).rejects.toThrow(/no fresh tickers/);
    await expect(feed.refresh(NOW + 1)).rejects.toThrow(/no fresh tickers/);
    expect(feed.lastRefreshAt).toBe(NOW);
    expect(feed.view().tickers.get(instrument.instId)?.ts).toBe(NOW);
  });

  it("rejects timestamps too far in the future", async () => {
    const api = { tickers: async () => new Map([[instrument.instId, ticker(NOW + 30_001)]]) } as unknown as PublicApi;
    const feed = new MarketFeed(api, { min24hVolUsd: 1, allowNonCrypto: false, spreadGateBps: 30, trendCoins: [] }, null, () => []);
    await expect(feed.refreshTickers(NOW)).rejects.toThrow(/no fresh tickers/);
  });
});
