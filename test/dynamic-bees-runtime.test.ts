import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Alerts } from "../src/alerts.js";
import { defaultProfiles, newProfile, saveProfiles } from "../src/bee-profiles.js";
import { loadConfig, type BeeId, type Config } from "../src/config.js";
import { Db } from "../src/db.js";
import { Engine } from "../src/engine.js";
import { EventBus } from "../src/events.js";
import { SimExecutor } from "../src/exec/executor.js";
import { Jev } from "../src/jev.js";
import { freshBee } from "../src/ledger.js";
import type { MarketFeed } from "../src/market/data.js";
import { coin, NOW, view } from "./fixtures.js";

function config(path?: string): Config {
  const env: NodeJS.ProcessEnv = { BEE_PROFILES_PATH: path ?? join(tmpdir(), "bees-profiles-not-present.json") };
  return loadConfig(env);
}
function expanded(cfg: Config, id: string): Config {
  const dynamic = { ...cfg, beeIds: [...cfg.beeIds, id as unknown as BeeId] };
  Object.assign(dynamic.slots, { [id]: { ...cfg.slots.bee1!, name: "Clover", style: "bizzy", coins: ["BTC"], rules: "", instructions: "" } });
  return dynamic;
}
function deps(cfg: Config, db: Db) {
  const market = view([coin("BTC", {}, 100)]);
  const feed = { view: () => market, refresh: async () => {}, refreshTickers: async () => {}, lastRefreshAt: NOW } as unknown as MarketFeed;
  return { cfg, db, feed, jev: new Jev({ ...cfg.jev, now: () => NOW }), exec: new SimExecutor(() => market, cfg.risk.takerFeeRate), bus: new EventBus(db), alerts: new Alerts(undefined), now: () => NOW };
}

describe("dynamic paper bee runtime", () => {
  it("keeps the original three by default", () => {
    expect(config().beeIds).toEqual(["bee1", "bee2", "bee3"]);
  });

  it("ticks a fourth isolated paper ledger and restores it after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-bees-"));
    const db = new Db(join(dir, "paper.sqlite"));
    try {
      const profiles = defaultProfiles(), fourth = newProfile("Clover", "bizzy");
      profiles.profiles.push(fourth); saveProfiles(join(dir, "profiles.json"), profiles);
      const cfg = config(join(dir, "profiles.json"));
      expect(cfg.beeIds).toHaveLength(4);
      expect(cfg.beeIds.slice(0, 3)).toEqual(["bee1", "bee2", "bee3"]);
      const runtime = expanded(cfg, fourth.id);
      const legacy = freshBee("bee1", 333, NOW);
      legacy.cashUsd = 321; legacy.equityUsd = 321;
      legacy.position = { instId: "BTC-USD_UM_XPERP-310404", coin: "BTC", side: "long", contracts: 1, entryPx: 100, openedAt: NOW - 60_000, stopPx: 90, riskUsd: 10 };
      db.saveBee(legacy, NOW);
      const first = new Engine(deps(runtime, db));
      await first.start();
      expect(first.bees.bee1.cashUsd).toBe(321);
      expect(first.bees.bee1.position).toMatchObject({ coin: "BTC", contracts: 1 });
      first.bees[fourth.id as unknown as BeeId].cashUsd = 271;
      await first.tick();
      first.stop();
      expect(first.bees[fourth.id as unknown as BeeId].equityUsd).toBeCloseTo(271);
      expect(db.loadBee(fourth.id as unknown as BeeId)?.equityUsd).toBeCloseTo(271);
      expect(db.loadBee("bee1")?.cashUsd).toBe(321);
      const restarted = new Engine(deps(runtime, db));
      await restarted.start();
      expect(restarted.bees[fourth.id as unknown as BeeId].equityUsd).toBeCloseTo(271);
      restarted.stop();
    } finally { db.raw.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses startup when an archived profile still has an open position", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-bees-"));
    const db = new Db(join(dir, "paper.sqlite"));
    try {
      const profiles = defaultProfiles(), fourth = newProfile("Clover", "bizzy");
      profiles.profiles.push({ ...fourth, active: false }); saveProfiles(join(dir, "profiles.json"), profiles);
      const archived = freshBee(fourth.id as unknown as BeeId, 333, NOW);
      archived.position = { instId: "BTC-USD_UM_XPERP-310404", coin: "BTC", side: "long", contracts: 1, entryPx: 100, openedAt: NOW, stopPx: 95, riskUsd: 5 };
      db.saveBee(archived, NOW);
      const cfg = config(join(dir, "profiles.json"));
      await expect(new Engine(deps(cfg, db)).start()).rejects.toThrow(/open paper position/);
    } finally { db.raw.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
