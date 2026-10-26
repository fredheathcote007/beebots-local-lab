import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalShadow, LOCAL_SHADOW_MODEL, LOCAL_SYSTEM_ONE_URL, type ShadowAsk, type ShadowRecord } from "../src/local-shadow.js";
import { Db } from "../src/db.js";
import { Alerts } from "../src/alerts.js";
import { Engine } from "../src/engine.js";
import { EventBus } from "../src/events.js";
import { SimExecutor } from "../src/exec/executor.js";
import { Jev } from "../src/jev.js";
import { coin, NOW, testConfig, view } from "./fixtures.js";
import type { BeeId } from "../src/config.js";
import deciderFixture from "./fixtures/decider-4b-v2.1.response.json" with { type: "json" };

const ask: ShadowAsk = {
  bee: "bee1", ts: 1000, marketTs: 900, strategy: "test strategy", state: { utc: "12:00", me: { pos: "flat" } },
  menu: { WAIT: { desc: "hold", intent: { kind: "hold" } }, OPEN: { desc: "open", intent: { kind: "open", instId: "BTC-X", side: "long", sizeFrac: 0.5, setup: "strict" } } },
  convictionLabels: ["low", "medium", "high"], baselineChoice: "WAIT",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const good = { model: LOCAL_SHADOW_MODEL, answers: { action: { choice: "OPEN", probabilities: { WAIT: 0.25, OPEN: 0.75 } } } };
const recordedAsk: ShadowAsk = { ...ask, menu: {
  WAIT: { desc: "wait", intent: { kind: "hold" } },
  BUY_BTC: { desc: "buy", intent: { kind: "hold" } },
  SELL_BTC: { desc: "sell", intent: { kind: "hold" } },
} };

describe("local System One shadow", () => {
  it("POSTs native System One semantics to the fixed loopback endpoint and records distribution + baseline", async () => {
    let sentUrl = ""; let sent: Record<string, unknown> = {}; let sentHeaders: Record<string, string> | undefined; let redirect: string | undefined;
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async (url: string, init: RequestInit) => { sentUrl = url; sentHeaders = init.headers as Record<string, string>; redirect = init.redirect; sent = JSON.parse(String(init.body)); return response(good); }) as unknown as typeof fetch, onRecord: (r) => rows.push(r) });
    shadow.submit(ask);
    await new Promise((r) => setTimeout(r, 0));
    expect(sentUrl).toBe(LOCAL_SYSTEM_ONE_URL);
    expect(sentHeaders).toEqual({ "content-type": "application/json" });
    expect(redirect).toBe("error");
    expect(sent).toMatchObject({ model: LOCAL_SHADOW_MODEL, state: ask.state, questions: {
      action: { type: "choice", instructions: "test strategy Pick your next move.", criteria: { WAIT: "hold", OPEN: "open" } },
      conviction: { type: "score", instructions: "Signal strength?", criteria: ["low", "medium", "high"] },
    } });
    expect(rows[0]).toMatchObject({ status: "ok", model: LOCAL_SHADOW_MODEL, choice: "OPEN", probabilities: { WAIT: 0.25, OPEN: 0.75 }, baselineChoice: "WAIT", marketTs: 900 });
  });

  it("rejects redirect responses without accepting their body as a model choice", async () => {
    let redirect: string | undefined;
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async (_url: string, init: RequestInit) => {
      redirect = init.redirect;
      return response(good, 302);
    }) as unknown as typeof fetch, onRecord: (r) => rows.push(r) });
    shadow.submit(ask);
    await new Promise((r) => setTimeout(r, 0));
    expect(redirect).toBe("error");
    expect(rows[0]).toMatchObject({ status: "rejected", choice: null, probabilities: null });
  });

  it("bounds response reads before parsing model output", async () => {
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async () => new Response("x".repeat(64 * 1024 + 1))) as typeof fetch, onRecord: (r) => rows.push(r) });
    shadow.submit(ask);
    await new Promise((r) => setTimeout(r, 0));
    expect(rows[0]).toMatchObject({ status: "rejected", choice: null, probabilities: null });
  });

  it("accepts the recorded Decider-4B v2.1 action contract and ignores action confidence", async () => {
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async () => response(deciderFixture)) as typeof fetch, onRecord: (r) => rows.push(r) });
    shadow.submit(recordedAsk);
    await new Promise((r) => setTimeout(r, 0));
    expect(rows[0]).toMatchObject({ status: "ok", model: "decider-4b-v2.1", choice: "WAIT", probabilities: { WAIT: 0.9845, BUY_BTC: 0.0129, SELL_BTC: 0.0026 } });
  });

  it("rejects malformed/off-menu choices, wrong model IDs, and invalid distributions", async () => {
    for (const payload of [
      { ...good, model: "other-model" },
      { ...good, answers: { action: { choice: "YOLO", probabilities: { WAIT: 0.25, OPEN: 0.75 } } } },
      { ...good, answers: { action: { choice: "OPEN", probabilities: { WAIT: 0.2, OPEN: 0.2 } } } },
      { ...good, answers: { action: { choice: "OPEN", probabilities: { WAIT: -0.2, OPEN: 1.2 } } } },
    ]) {
      const rows: ShadowRecord[] = [];
      new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async () => response(payload)) as typeof fetch, onRecord: (r) => rows.push(r) }).submit(ask);
      await new Promise((r) => setTimeout(r, 0));
      expect(rows[0]?.status).toBe("rejected");
      expect(rows[0]?.choice).toBeNull();
    }
  });

  it("records unavailable, timeout, and network errors; three failures open circuit", async () => {
    let now = 10_000; let n = 0; const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, now: () => now, minIntervalMs: 0, fetchFn: (async () => { n++; return response({}, 503); }) as typeof fetch, onRecord: (r) => rows.push(r) });
    for (let i = 0; i < 3; i++) { shadow.submit({ ...ask, bee: `b${i}` }); await new Promise((r) => setTimeout(r, 0)); }
    shadow.submit({ ...ask, bee: "other" });
    await new Promise((r) => setTimeout(r, 5));
    expect(n).toBe(3);
    expect(rows.map((r) => r.status)).toEqual(["unavailable", "unavailable", "unavailable", "skipped"]);
    expect(rows[3]).toMatchObject({ reason: "circuit" });
    now += 60_001;
    const timeoutRows: ShadowRecord[] = [];
    const timed = new LocalShadow({ enabled: true, timeoutMs: 5, minIntervalMs: 0, fetchFn: (async (_u: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))))) as typeof fetch, onRecord: (r) => timeoutRows.push(r) });
    timed.submit(ask); await new Promise((r) => setTimeout(r, 15));
    expect(timeoutRows[0]?.status).toBe("timeout");
    const errors: ShadowRecord[] = [];
    new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async () => { throw new Error("offline"); }) as typeof fetch, onRecord: (r) => errors.push(r) }).submit(ask);
    await new Promise((r) => setTimeout(r, 0)); expect(errors[0]?.status).toBe("error");
  });

  it("disabled and paced submissions have zero effects; call returns without waiting for model", async () => {
    let calls = 0; let resolve!: (v: Response) => void;
    const pending = new Promise<Response>((r) => { resolve = r; });
    const shadow = new LocalShadow({ enabled: true, fetchFn: (async () => { calls++; return pending; }) as typeof fetch, onRecord: () => {} });
    const t0 = Date.now(); shadow.submit(ask);
    expect(Date.now() - t0).toBeLessThan(50);
    shadow.submit(ask); expect(calls).toBe(1);
    const off = new LocalShadow({ enabled: false, fetchFn: (async () => { calls++; return response(good); }) as typeof fetch, onRecord: () => {} });
    off.submit(ask); expect(calls).toBe(1);
    resolve(response(good));
  });

  it("does not send a shadow request for stale market input and records the stale outcome", async () => {
    let calls = 0; const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, fetchFn: (async () => { calls++; return response(good); }) as typeof fetch, onRecord: (r) => rows.push(r) });
    shadow.submit({ ...ask, marketTs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(0);
    expect(rows[0]).toMatchObject({ status: "stale", choice: null, probabilities: null, baselineChoice: "WAIT" });
  });

  it("persists only to its append-only shadow table and retains existing bee state", () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-restart-"));
    const path = join(dir, "paper.sqlite");
    try {
      const db = new Db(path);
      db.insertShadowDecision({ bee: ask.bee, ts: ask.ts, marketTs: ask.marketTs, model: LOCAL_SHADOW_MODEL, choice: "OPEN", probabilities: { WAIT: 0.25, OPEN: 0.75 }, baselineChoice: "WAIT", status: "ok", latencyMs: 4 });
      expect(db.raw.prepare("SELECT bee, choice, baseline_choice, status FROM shadow_decisions").get()).toEqual({ bee: "bee1", choice: "OPEN", baseline_choice: "WAIT", status: "ok" });
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM decisions").get()).toEqual({ n: 0 });
      db.close();
      const restarted = new Db(path);
      expect(restarted.raw.prepare("SELECT bee, choice, baseline_choice, status FROM shadow_decisions").get()).toEqual({ bee: "bee1", choice: "OPEN", baseline_choice: "WAIT", status: "ok" });
      expect(restarted.raw.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
      restarted.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rate-limits skipped coverage rows and keeps malformed replies out of the transport circuit", async () => {
    let now = 10_000; const rows: ShadowRecord[] = [];
    const paced = new LocalShadow({ enabled: true, now: () => now, minIntervalMs: 60_000, fetchFn: (async () => response(good)) as typeof fetch, onRecord: (r) => rows.push(r) });
    paced.submit(ask); await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 8; i++) paced.submit({ ...ask, ts: now + i });
    await new Promise((r) => setTimeout(r, 5));
    expect(rows.filter((r) => r.reason === "paced")).toHaveLength(1);
    now += 60_001;
    const malformed: ShadowRecord[] = [];
    const rejects = new LocalShadow({ enabled: true, now: () => now, minIntervalMs: 0, fetchFn: (async () => response({ model: LOCAL_SHADOW_MODEL, answers: { action: { choice: "NOPE", probabilities: {} } } })) as typeof fetch, onRecord: (r) => malformed.push(r) });
    for (let i = 0; i < 3; i++) { rejects.submit({ ...ask, bee: `reject${i}` }); await new Promise((r) => setTimeout(r, 0)); }
    rejects.submit({ ...ask, bee: "after-rejects" }); await new Promise((r) => setTimeout(r, 0));
    expect(malformed.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    const invalidJson: ShadowRecord[] = [];
    const invalidBody = new LocalShadow({ enabled: true, minIntervalMs: 0, fetchFn: (async () => new Response("not json")) as typeof fetch, onRecord: (r) => invalidJson.push(r) });
    for (let i = 0; i < 4; i++) { invalidBody.submit({ ...ask, bee: `json${i}` }); await new Promise((r) => setTimeout(r, 0)); }
    expect(invalidJson.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
  });

  it("allows all three bees to shadow concurrently without first-bee starvation", async () => {
    const started: string[] = []; const rows: ShadowRecord[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const shadow = new LocalShadow({ enabled: true, fetchFn: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { state: { bee?: string } };
      started.push(String(body.state.bee));
      await gate;
      return response(good);
    }) as typeof fetch, onRecord: (r) => rows.push(r) });
    for (const bee of ["bee1", "bee2", "bee3"]) shadow.submit({ ...ask, bee, state: { bee } });
    expect(started).toEqual(["bee1", "bee2", "bee3"]);
    release(); await new Promise((r) => setTimeout(r, 5));
    expect(rows.map((r) => r.bee)).toEqual(["bee1", "bee2", "bee3"]);
  });

  it("queues the fourth dynamic bee fairly behind the three in-flight requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, fetchFn: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { state: { bee?: string } };
      started.push(body.state.bee!);
      await gate;
      return response(good);
    }) as typeof fetch, onRecord: (r) => rows.push(r) });
    for (const bee of ["bee1", "bee2", "bee3", "bee_extra"])
      shadow.submit({ ...ask, bee, state: { bee }, baselineChoice: `base:${bee}` });
    expect(started).toEqual(["bee1", "bee2", "bee3"]);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual(["bee1", "bee2", "bee3", "bee_extra"]);
    expect(rows.find((r) => r.bee === "bee_extra" && r.status === "ok")).toMatchObject({ bee: "bee_extra", baselineChoice: "base:bee_extra", status: "ok" });
  });

  it("records a queued snapshot as stale when it expires before dispatch", async () => {
    let now = 10_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    const rows: ShadowRecord[] = [];
    const shadow = new LocalShadow({ enabled: true, now: () => now, maxMarketAgeMs: 200, fetchFn: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { state: { bee?: string } };
      started.push(body.state.bee!);
      await gate;
      return response(good);
    }) as typeof fetch, onRecord: (r) => rows.push(r) });
    for (const bee of ["bee1", "bee2", "bee3"]) shadow.submit({ ...ask, bee, state: { bee } });
    shadow.submit({ ...ask, bee: "bee4", state: { bee: "bee4" } });
    expect(started).toEqual(["bee1", "bee2", "bee3"]);
    now += 101; // Original snapshot age (100ms) plus queue wait now exceeds 200ms.
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual(["bee1", "bee2", "bee3"]);
    expect(rows.find((r) => r.bee === "bee4" && r.status === "stale")).toMatchObject({ status: "stale", choice: null, probabilities: null });
  });

  it("wires shadow at multi-option engine decisions without changing paper decisions or orders", async () => {
    const market = view([coin("ENA", { ret24hPct: 25, ret7dPct: 43 }), coin("SUI", { ret24hPct: 12, ret7dPct: 40 }), coin("BTC", { ret24hPct: 1, ret7dPct: 2 }, 80_000)]);
    const run = async (withShadow: boolean) => {
      const cfg = testConfig(); const db = new Db(":memory:"); let submitted = 0;
      const feed = { view: () => market, refresh: async () => {}, refreshTickers: async () => {}, lastRefreshAt: NOW } as never;
      const shadow = withShadow ? { submit: () => { submitted++; }, notePaused: () => {} } as never : undefined;
      const engine = new Engine({ cfg, db, feed, jev: new Jev({ ...cfg.jev, now: () => NOW }), shadow, exec: new SimExecutor(() => market, cfg.risk.takerFeeRate, () => NOW), bus: new EventBus(db), alerts: new Alerts(undefined), now: () => NOW });
      await engine.start(); await engine.tick(); engine.stop();
      const decisions = db.raw.prepare("SELECT bee, choice, action_json FROM decisions ORDER BY bee").all();
      const orders = db.raw.prepare("SELECT bee, inst_id, side, contracts FROM orders ORDER BY bee, id").all();
      const positions = Object.fromEntries(Object.entries(engine.bees).map(([id, b]) => [id, b.position]));
      db.close();
      return { submitted, decisions, orders, positions };
    };
    const baseline = await run(false); const shadowRun = await run(true);
    expect(shadowRun.submitted).toBeGreaterThan(0);
    expect(shadowRun.decisions).toEqual(baseline.decisions);
    expect(shadowRun.orders).toEqual(baseline.orders);
    expect(shadowRun.positions).toEqual(baseline.positions);
  });

  it("submits a dynamic fourth profile ID and its instruction text while preserving deterministic outcomes", async () => {
    const market = view([coin("ENA", { ret24hPct: 25, ret7dPct: 43 }), coin("SUI", { ret24hPct: 12, ret7dPct: 40 }), coin("BTC", { ret24hPct: 1, ret7dPct: 2 }, 80_000)]);
    const dynamicId = "bee_123e4567-e89b-12d3-a456-426614174000" as BeeId;
    const run = async (withShadow: boolean) => {
      const cfg = testConfig();
      cfg.beeIds.push(dynamicId);
      cfg.slots[dynamicId] = { style: "boozy", name: "Clover", tagline: "the grinder", customImage: false, rules: "", instructions: "Prefer patient entries.", coins: [], fromSetup: false };
      const db = new Db(":memory:"); const asks: ShadowAsk[] = [];
      const feed = { view: () => market, refresh: async () => {}, refreshTickers: async () => {}, lastRefreshAt: NOW } as never;
      const shadow = withShadow ? { submit: (a: ShadowAsk) => asks.push(a), notePaused: () => {} } as never : undefined;
      const engine = new Engine({ cfg, db, feed, jev: new Jev({ ...cfg.jev, now: () => NOW }), shadow, exec: new SimExecutor(() => market, cfg.risk.takerFeeRate, () => NOW), bus: new EventBus(db), alerts: new Alerts(undefined), now: () => NOW });
      await engine.start(); await engine.tick(); engine.stop();
      const decisions = db.raw.prepare("SELECT bee, choice, action_json FROM decisions ORDER BY bee").all();
      const orders = db.raw.prepare("SELECT bee, inst_id, side, contracts FROM orders ORDER BY bee, id").all();
      const positions = Object.fromEntries(Object.entries(engine.bees).map(([id, b]) => [id, b.position]));
      db.close();
      return { asks, decisions, orders, positions };
    };
    const baseline = await run(false); const observed = await run(true);
    const fourthAsk = observed.asks.find((a) => a.bee === dynamicId);
    expect(fourthAsk).toMatchObject({ bee: dynamicId, baselineChoice: expect.any(String) });
    expect(fourthAsk?.strategy).toContain("Prefer patient entries.");
    expect(Object.keys(observed.positions)).toContain(dynamicId);
    expect(Object.keys(observed.positions)).toHaveLength(4);
    const originalIds = new Set(["bee1", "bee2", "bee3"]);
    expect(observed.decisions.filter((r) => originalIds.has((r as { bee: string }).bee))).toEqual(baseline.decisions.filter((r) => originalIds.has((r as { bee: string }).bee)));
    expect(observed.orders.filter((r) => originalIds.has((r as { bee: string }).bee))).toEqual(baseline.orders.filter((r) => originalIds.has((r as { bee: string }).bee)));
    for (const id of originalIds) expect(observed.positions[id]).toEqual(baseline.positions[id]);
    expect(observed.orders).toEqual(baseline.orders); // Shadow may observe legitimate paper fills, but must never change them.
  });
});
