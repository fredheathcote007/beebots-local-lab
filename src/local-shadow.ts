import { createRequire } from "node:module";
import type * as SDK from "@typesafe-ai/sdk" with { "resolution-mode": "require" };
import type { Menu } from "./bees/types.js";
import { LOCAL_SHADOW_RUNTIME } from "./config.js";

const require = createRequire(import.meta.url);
const { choice, score } = require("@typesafe-ai/sdk") as typeof SDK;

/** Shadow-only native System One caller. The endpoint is deliberately fixed to host loopback. */
export const LOCAL_SHADOW_CONFIG = Object.freeze({
  url: LOCAL_SHADOW_RUNTIME.url,
  model: LOCAL_SHADOW_RUNTIME.model,
  maxConcurrent: 3,
  minIntervalMs: 60_000,
});
export const LOCAL_SYSTEM_ONE_URL = LOCAL_SHADOW_CONFIG.url;
export const LOCAL_SHADOW_MODEL = LOCAL_SHADOW_CONFIG.model;
export interface ShadowAsk {
  bee: string; ts: number; marketTs: number; strategy: string; state: Record<string, unknown>;
  menu: Menu; convictionLabels: readonly string[]; baselineChoice: string;
}
export interface ShadowRecord extends ShadowAsk {
  model: string; choice: string | null; probabilities: Record<string, number> | null;
  status: "ok" | "unavailable" | "timeout" | "error" | "rejected" | "stale" | "skipped";
  reason?: "paused" | "paced" | "circuit" | "busy"; latencyMs: number;
}
export type ShadowFetch = typeof fetch;

export class LocalShadow {
  private lastCall = new Map<string, number>();
  private active = 0;
  private queue: ShadowAsk[] = [];
  private queued = new Map<string, ShadowAsk>();
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private circuitUntil = 0;
  private failures = 0;
  private lastSkip = new Map<string, number>();
  private now: () => number;
  constructor(private opts: { enabled: boolean; fetchFn?: ShadowFetch; now?: () => number; timeoutMs?: number; minIntervalMs?: number; maxMarketAgeMs?: number; onRecord: (row: ShadowRecord) => void }) {
    this.now = opts.now ?? Date.now;
  }
  /** Bounded coverage marker for engine states where a bee is intentionally not asked to decide. */
  notePaused(bee: string, ts: number, marketTs: number): void {
    if (!this.opts.enabled) return;
    this.skipped({ bee, ts, marketTs, strategy: "", state: {}, menu: {}, convictionLabels: [], baselineChoice: "PAUSED" }, "paused");
  }
  /** Fire-and-forget entrypoint. Returns immediately; the paper decision never awaits this promise. */
  submit(ask: ShadowAsk): void {
    if (!this.opts.enabled) return;
    if (ask.marketTs <= 0 || ask.marketTs > ask.ts || ask.ts - ask.marketTs > (this.opts.maxMarketAgeMs ?? 180_000)) {
      if (this.allowCoverage(ask.bee, "stale")) this.record({ ...ask, model: LOCAL_SHADOW_MODEL, choice: null, probabilities: null, status: "stale", latencyMs: 0 });
      return;
    }
    if (this.now() < this.circuitUntil) return this.skipped(ask, "circuit");
    const interval = Math.max(LOCAL_SHADOW_CONFIG.minIntervalMs, this.opts.minIntervalMs ?? 0);
    const prev = this.lastCall.get(ask.bee);
    const eligible = prev === undefined || this.now() - prev >= interval;
    if (eligible && this.active < LOCAL_SHADOW_CONFIG.maxConcurrent && this.queue.length === 0) {
      this.dispatch(ask);
      return;
    }
    const existing = this.queued.get(ask.bee);
    if (existing) {
      // Keep its FIFO place while refreshing state to the newest market snapshot.
      const index = this.queue.indexOf(existing);
      this.queued.set(ask.bee, ask);
      if (index >= 0) this.queue[index] = ask;
    } else if (this.queue.length < 16) {
      this.queued.set(ask.bee, ask);
      this.queue.push(ask);
    } else {
      this.skipped(ask, "busy");
      return;
    }
    this.skipped(ask, eligible ? "busy" : "paced");
    this.drain();
  }
  private dispatch(ask: ShadowAsk): void {
    this.lastCall.set(ask.bee, this.now());
    this.active++;
    void this.call(ask).finally(() => { this.active--; this.drain(); });
  }
  /** Starts eligible asks in FIFO order, skipping paced bees so they cannot block other owners. */
  private drain(): void {
    if (!this.opts.enabled || this.now() < this.circuitUntil) return;
    const interval = Math.max(LOCAL_SHADOW_CONFIG.minIntervalMs, this.opts.minIntervalMs ?? 0);
    while (this.active < LOCAL_SHADOW_CONFIG.maxConcurrent && this.queue.length) {
      const now = this.now();
      const eligibleAt = (ask: ShadowAsk) => Math.max(this.lastCall.get(ask.bee) ?? Number.NEGATIVE_INFINITY, now - interval) + interval;
      const index = this.queue.findIndex((ask) => {
        const prev = this.lastCall.get(ask.bee);
        return prev === undefined || now - prev >= interval;
      });
      if (index < 0) {
        const nextAt = Math.min(...this.queue.map(eligibleAt));
        if (this.wakeTimer) clearTimeout(this.wakeTimer);
        this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.drain(); }, Math.max(1, nextAt - now));
        this.wakeTimer.unref?.();
        return;
      }
      const [ask] = this.queue.splice(index, 1);
      if (!ask) continue;
      this.queued.delete(ask.bee);
      if (ask.marketTs <= 0 || ask.marketTs > ask.ts || ask.ts - ask.marketTs > (this.opts.maxMarketAgeMs ?? 180_000)) {
        if (this.allowCoverage(ask.bee, "stale")) this.record({ ...ask, model: LOCAL_SHADOW_MODEL, choice: null, probabilities: null, status: "stale", latencyMs: 0 });
      } else this.dispatch(ask);
    }
  }
  private skipped(ask: ShadowAsk, reason: "paused" | "paced" | "circuit" | "busy"): void {
    // Persist skipped coverage at most once per bee/reason/minute; ordinary 10s ticks cannot flood SQLite.
    if (!this.allowCoverage(ask.bee, reason)) return;
    this.record({ ...ask, model: LOCAL_SHADOW_MODEL, choice: null, probabilities: null, status: "skipped", reason, latencyMs: 0 });
  }
  private allowCoverage(bee: string, kind: string): boolean {
    const key = `${bee}:${kind}`;
    const at = this.now();
    if (at - (this.lastSkip.get(key) ?? Number.NEGATIVE_INFINITY) < 60_000) return false;
    this.lastSkip.set(key, at);
    return true;
  }
  private record(row: ShadowRecord): void {
    // Defer SQLite/log callbacks so a submission or a settled HTTP request never runs persistence inside the paper tick.
    setImmediate(() => {
      try { this.opts.onRecord(row); } catch { /* isolated shadow persistence failure */ }
    });
  }
  private async call(ask: ShadowAsk): Promise<void> {
    const start = this.now();
    const labels = Object.keys(ask.menu);
    const conviction = ask.convictionLabels.length > 1 ? ask.convictionLabels as [string, string, ...string[]] : ["low", "high"] as [string, string];
    const expectedModel = LOCAL_SHADOW_CONFIG.model;
    const req = { model: expectedModel, state: ask.state, questions: {
      action: choice(`${ask.strategy} Pick your next move.`, Object.fromEntries(labels.map((l) => [l, ask.menu[l]!.desc]))),
      conviction: score("Signal strength?", conviction),
    } };
    let status: ShadowRecord["status"] = "error";
    let countsTowardCircuit = false;
    let model = expectedModel;
    let picked: string | null = null;
    let probabilities: Record<string, number> | null = null;
    try {
      const res = await (this.opts.fetchFn ?? fetch)(LOCAL_SYSTEM_ONE_URL, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 12_000),
      });
      if (!res.ok) {
        status = res.status >= 500 ? "unavailable" : "rejected";
        countsTowardCircuit = res.status >= 500;
        throw new Error(`local endpoint HTTP ${res.status}`);
      }
      // Once an HTTP response arrives, body parse/schema failures are contract rejections, not transport faults.
      status = "rejected";
      const data = await res.json() as { model?: unknown; answers?: { action?: { choice?: unknown; probabilities?: unknown } } };
      if (data.model !== expectedModel || !data.answers?.action || typeof data.answers.action.choice !== "string" || !labels.includes(data.answers.action.choice)) { status = "rejected"; throw Object.assign(new Error("invalid local model response"), { silent: true }); }
      const raw = data.answers.action.probabilities;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { status = "rejected"; throw Object.assign(new Error("invalid probability distribution"), { silent: true }); }
      const dist = raw as Record<string, unknown>;
      if (Object.keys(dist).some((k) => !labels.includes(k)) || labels.some((k) => typeof dist[k] !== "number" || !Number.isFinite(dist[k]) || (dist[k] as number) < 0 || (dist[k] as number) > 1)) { status = "rejected"; throw Object.assign(new Error("invalid probability distribution"), { silent: true }); }
      const probs = Object.fromEntries(labels.map((k) => [k, dist[k] as number]));
      if (Math.abs(Object.values(probs).reduce((a, b) => a + b, 0) - 1) > 0.01) { status = "rejected"; throw Object.assign(new Error("probabilities do not sum to one"), { silent: true }); }
      model = data.model; picked = data.answers.action.choice; probabilities = probs; status = "ok";
      this.failures = 0; this.circuitUntil = 0;
    } catch (err) {
      const e = err as { name?: string };
      if (status === "error") { status = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "error"; countsTowardCircuit = true; }
      if (countsTowardCircuit) {
        this.failures++;
        if (this.failures >= 3) this.circuitUntil = this.now() + 60_000;
      }
    }
    this.record({ ...ask, model, choice: picked, probabilities, status, latencyMs: Math.max(0, this.now() - start) });
  }
}
