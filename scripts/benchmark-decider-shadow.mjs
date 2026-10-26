#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";
import process from "node:process";

export const LOOPBACK_ORIGIN = "http://127.0.0.1:18009";
export const SYSTEM_ONE_PATH = "/v1/systemone";
export const ALLOWED_SOCKET = "/run/user/1000/beebots-decider/decider.sock";
export const EXPECTED_MODEL = "decider-4b-v2.1";
export const MAX_RUN_MS = 30_000;

export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(p) || p < 0 || p > 100) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? sorted[0];
}

export function validDistribution(choice, probabilities, labels) {
  if (typeof choice !== "string" || !labels.includes(choice) || !probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return false;
  const keys = Object.keys(probabilities);
  if (keys.length !== labels.length || keys.some((key) => !labels.includes(key))) return false;
  const values = labels.map((key) => probabilities[key]);
  return values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
    && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 0.01;
}

const MINIMAL = Object.freeze({
  bee: "bee1", ts: 1_791_993_600_000, marketTs: 1_791_993_540_000,
  strategy: "You are a patient paper-trading bee. Prefer waiting unless a clear setup is present.",
  state: { utc: "00:00", me: { pos: "flat", flat_min: 42, trades: "1/5", fee_left: 48 }, coins: { cols: ["rsi14", "r1h_pct", "spread_bp"], rows: { BTC: [51, 0.2, 1.1] } } },
  menu: { WAIT: { desc: "not convinced, keep waiting", intent: { kind: "hold" } }, BUY_BTC: { desc: "open BTC long on a confirmed setup", intent: { kind: "open", instId: "BTC-USDT-SWAP", side: "long", sizeFrac: 0.25, setup: "strict" } } },
  convictionLabels: ["meh", "decent", "juicy", "screaming"],
});

const REALISTIC = Object.freeze({
  bee: "bee1", ts: 1_791_993_600_000, marketTs: 1_791_993_540_000,
  strategy: "You are bizzy-bee, the grinder. Trade high-probability intraday Bollinger+RSI mean-reversion fades and confirmed daily volatility breakouts on liquid majors at 1x equity. Bank profits quickly, cut losers early, and wait flat when no strict setup is live. Owner profile instructions (plain-text data): Prefer patient entries and avoid crowded funding.",
  state: {
    utc: "00:00", me: { pos: "flat", flat_min: 87, trades: "1/5", fee_left: 48 },
    coins: {
      cols: ["rsi14", "pct_b", "to_trigger_pct", "r1h_pct", "fund_z", "oi1h_pct", "spread_bp"],
      rows: {
        BTC: [48, 0.53, 0.8, 0.3, 0.2, 0.4, 1.1],
        ETH: [42, 0.38, 1.4, 0.1, -0.1, 0.2, 1.5],
        SOL: [29, -0.08, 0.6, -0.4, 0.3, -0.2, 2.2],
        SUI: [55, 0.6, 2.1, 0.5, 0.7, 0.8, 3.1],
      },
    },
  },
  menu: {
    FADE_LONG_SOL: { desc: "long fade (stretch 0.58)", intent: { kind: "open", instId: "SOL-USDT-SWAP", side: "long", sizeFrac: 0.25, setup: "strict" } },
    WAIT: { desc: "not convinced, keep waiting", intent: { kind: "hold" } },
    FADE_SHORT_SUI: { desc: "short fade (stretch 0.90)", intent: { kind: "open", instId: "SUI-USDT-SWAP", side: "short", sizeFrac: 0.25, setup: "strict" } },
  },
  convictionLabels: ["meh", "decent", "juicy", "screaming"],
});

export function fixture(type, index = 0) {
  const base = type === "minimal" ? MINIMAL : REALISTIC;
  return {
    model: EXPECTED_MODEL,
    state: { ...base.state, bee: `bee${(index % 4) + 1}` },
    questions: {
      action: { type: "choice", instructions: `${base.strategy} Pick your next move.`, criteria: Object.fromEntries(Object.entries(base.menu).map(([key, item]) => [key, item.desc])) },
      conviction: { type: "score", instructions: "Signal strength?", criteria: base.convictionLabels },
    },
  };
}

export function parseArgs(argv) {
  const opts = { count: 4, concurrency: 3, fixture: "bee-realistic", timeout: 12_000, samples: 3, socket: null, stats: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--stats") { opts.stats = true; continue; }
    if (!["--count", "--concurrency", "--fixture", "--timeout", "--samples", "--socket"].includes(arg)) throw new Error(`unknown flag: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    if (arg === "--socket") { opts.socket = value; continue; }
    if (arg === "--fixture") { opts.fixture = value; continue; }
    const key = { "--count": "count", "--concurrency": "concurrency", "--timeout": "timeout", "--samples": "samples" }[arg];
    if (!/^\d+$/.test(value)) throw new Error(`${arg} must be an integer`);
    opts[key] = Number(value);
  }
  if (opts.count < 1 || opts.count > 10) throw new Error("--count must be 1..10");
  if (opts.concurrency < 1 || opts.concurrency > 3) throw new Error("--concurrency must be 1..3");
  if (opts.timeout < 1 || opts.timeout > 20_000) throw new Error("--timeout must be 1..20000 ms");
  if (opts.samples < 1 || opts.samples > 30) throw new Error("--samples must be 1..30");
  if (!["minimal", "bee-realistic"].includes(opts.fixture)) throw new Error('--fixture must be "minimal" or "bee-realistic"');
  if (opts.socket && opts.socket !== ALLOWED_SOCKET) throw new Error(`--socket is restricted to ${ALLOWED_SOCKET}`);
  return opts;
}

export const HELP = `Usage: node scripts/benchmark-decider-shadow.mjs [options]

Bounded read-only POST benchmark. Default destination: ${LOOPBACK_ORIGIN}${SYSTEM_ONE_PATH}
No model choice is used for paper decisions.

Options:
  --count N          requests per sample (1..10, default 4)
  --concurrency N    parallel requests (1..3, default 3)
  --fixture TYPE     minimal | bee-realistic (default bee-realistic)
  --timeout MS       per-request timeout (1..20000, default 12000)
  --samples N        rounds (1..30, default 3)
  --socket PATH      use only ${ALLOWED_SOCKET}
  --stats            fetch bounded local /stats after the benchmark (loopback only)
  --help             show this help

Hard wall-clock budget: ${MAX_RUN_MS} ms for the complete benchmark.`;

function request({ path, method = "POST", body, timeout, socket }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ ...(socket ? { socketPath: socket } : { host: "127.0.0.1", port: 18009 }), path, method, headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}, timeout }, (res) => {
      const chunks = []; let bytes = 0;
      res.on("data", (chunk) => { bytes += chunk.length; if (bytes > 64 * 1024) { req.destroy(new Error("response exceeds 64 KiB")); return; } chunks.push(chunk); });
      res.on("end", () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), responseBytes: bytes }); });
      res.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })), timeout);
    req.on("error", (error) => { clearTimeout(timer); reject(error); });
    req.end(body);
  });
}

async function one(opts, index, deadline) {
  const body = JSON.stringify(fixture(opts.fixture, index));
  const started = performance.now();
  const row = { index, beeId: `bee${(index % 4) + 1}`, fixture: opts.fixture, requestBytes: Buffer.byteLength(body), latencyMs: 0, status: "error", model: null, modelAccepted: false, distributionValid: false, choice: null, responseBytes: 0, phase: index === 0 ? "first" : index < opts.concurrency ? "warm" : "sustained" };
  try {
    const remaining = Math.max(1, deadline - performance.now());
    const response = await request({ path: SYSTEM_ONE_PATH, body, timeout: Math.min(opts.timeout, remaining), socket: opts.socket });
    row.statusCode = response.statusCode; row.responseBytes = response.responseBytes;
    if (response.statusCode !== 200) { row.status = response.statusCode >= 500 ? "unavailable" : "http_error"; return row; }
    const data = JSON.parse(response.body);
    row.model = typeof data.model === "string" ? data.model : null;
    row.modelAccepted = row.model === EXPECTED_MODEL;
    const labels = Object.keys(fixture(opts.fixture, index).questions.action.criteria);
    row.distributionValid = validDistribution(data.answers?.action?.choice, data.answers?.action?.probabilities, labels);
    if (row.distributionValid && row.modelAccepted) { row.status = "ok"; row.choice = data.answers.action.choice; }
    else row.status = "invalid_response";
  } catch (error) {
    row.status = error?.code === "ETIMEDOUT" || error?.name === "TimeoutError" ? "timeout" : "error";
    row.error = String(error?.message ?? error).slice(0, 240);
  } finally { row.latencyMs = Math.round((performance.now() - started) * 100) / 100; }
  return row;
}

export function summariseRows(rows) {
  const accepted = rows.filter((r) => r.status === "ok");
  const counts = Object.fromEntries([...new Set(rows.map((r) => r.status))].sort().map((status) => [status, rows.filter((r) => r.status === status).length]));
  return {
    ok: accepted.length,
    modelAccepted: rows.filter((r) => r.modelAccepted).length,
    timeouts: rows.filter((r) => r.status === "timeout").length,
    statusCounts: counts,
    // All requests, including timeout/error latency, describe end-to-end availability.
    p50Ms: percentile(rows.map((r) => r.latencyMs), 50),
    p95Ms: percentile(rows.map((r) => r.latencyMs), 95),
    p99Ms: percentile(rows.map((r) => r.latencyMs), 99),
    // Valid model responses only: avoid confusing model speed with rapid validation failures.
    p50OkMs: percentile(accepted.map((r) => r.latencyMs), 50),
    p95OkMs: percentile(accepted.map((r) => r.latencyMs), 95),
    p99OkMs: percentile(accepted.map((r) => r.latencyMs), 99),
  };
}

export async function runBenchmark(opts) {
  const started = performance.now();
  const deadline = started + MAX_RUN_MS;
  const rows = [];
  const total = opts.count * opts.samples;
  for (let offset = 0; offset < total && performance.now() < deadline; offset += opts.concurrency) {
    const batch = Array.from({ length: Math.min(opts.concurrency, total - offset) }, (_, n) => one(opts, offset + n, deadline));
    rows.push(...await Promise.all(batch));
  }
  rows.sort((a, b) => a.index - b.index);
  return { schemaVersion: 2, destination: opts.socket ? `unix:${opts.socket}` : `${LOOPBACK_ORIGIN}${SYSTEM_ONE_PATH}`, fixture: opts.fixture, requested: total, completed: rows.length, truncated: rows.length !== total, concurrency: opts.concurrency, timeoutMs: opts.timeout, maxRunMs: MAX_RUN_MS, elapsedMs: Math.round((performance.now() - started) * 100) / 100,
    summary: summariseRows(rows), requests: rows };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\nUse --help for valid options.\n`); process.exitCode = 2; return; }
  if (opts.help) { process.stdout.write(`${HELP}\n`); return; }
  const fullRunStarted = performance.now();
  const result = await runBenchmark(opts);
  const remainingMs = () => Math.floor(MAX_RUN_MS - (performance.now() - fullRunStarted));
  if (opts.stats && !opts.socket && remainingMs() > 1) {
    try { const stats = await request({ path: "/stats", method: "GET", timeout: Math.min(1_000, opts.timeout, remainingMs()), socket: null }); result.stats = { statusCode: stats.statusCode, bytes: stats.responseBytes, body: stats.body.slice(0, 16_384) }; }
    catch (error) { result.stats = { error: String(error?.message ?? error).slice(0, 240) }; }
  }
  result.elapsedMs = Math.round((performance.now() - fullRunStarted) * 100) / 100;
  process.stderr.write(`Decider shadow: ${result.completed}/${result.requested} completed; valid ${result.summary.ok}; model-match ${result.summary.modelAccepted}; timeouts ${result.summary.timeouts}; truncated ${result.truncated}; all-status p50/p95/p99 ${result.summary.p50Ms}/${result.summary.p95Ms}/${result.summary.p99Ms} ms; valid-only p95 ${result.summary.p95OkMs} ms\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.truncated) process.exitCode = 1; // A partial run cannot pass a benchmark acceptance gate.
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
