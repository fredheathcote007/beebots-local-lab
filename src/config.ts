import { z } from "zod";
import { STYLE_INFO, STYLES, type Settings, type StyleId } from "./settings.js";
import { existsSync } from "node:fs";
import { readProfiles } from "./bee-profiles.js";

/** Three bee slots. Each one trades one of the three styles (settings.ts); two bees may share a style. */
export const BEES = ["bee1", "bee2", "bee3"] as const;
// Runtime profile IDs are validated at the config boundary, then mapped through this built-in
// type to preserve exhaustive checks in the legacy engine collaborators.
export type BeeId = (typeof BEES)[number];
export { STYLES, type StyleId };

/** With no Setup file (settings only from .env), the bees are the original three. */
const DEFAULT_SLOTS: Record<BeeId, StyleId> = { bee1: "bizzy", bee2: "breezy", bee3: "boozy" };
/** Typed as the only acknowledgement that unlocks MODE=live. */
export const LIVE_ACK_PHRASE = "I-ACCEPT-REAL-MONEY-RISK";
/** Immutable host-only Decider endpoint and model identity. */
export const LOCAL_SHADOW_RUNTIME = Object.freeze({ url: "http://127.0.0.1:18009/v1/systemone", model: "decider-4b-v2.1" });
export const LOCAL_SHADOW_SOCKET_PATH = "/run/beebots-decider/decider.sock";
export type LocalShadowTransport = "host-loopback" | "unix-socket";

export type Mode = "dry" | "demo" | "live";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : /^(1|true|yes|on)$/i.test(v.trim())));
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return def;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a number" });
        return z.NEVER;
      }
      return n;
    });
const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : v.trim()));
const opt = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

// Per-style knobs: BIZZY_* = Breakout, BREEZY_* = Trend, BOOZY_* = Momentum. Every bee on that style uses them.
const perStyle = (prefix: string, d: { trades: number; fee: number; spread: number; cooldown: number; stopAtr: number; maxFlat: number }) => ({
  [`${prefix}_MAX_TRADES_PER_DAY`]: num(d.trades),
  [`${prefix}_FEE_BUDGET_USD_DAY`]: num(d.fee),
  [`${prefix}_SPREAD_GATE_BPS`]: num(d.spread),
  [`${prefix}_COOLDOWN_MINUTES`]: num(d.cooldown),
  [`${prefix}_STOP_ATR_MULT`]: num(d.stopAtr),
  [`${prefix}_MAX_FLAT_MINUTES`]: num(d.maxFlat),
});
// Per-bee OKX keys (demo or live only): BEE1_OKX_API_KEY, BEE1_OKX_DEMO_API_KEY, ...
const perSlot = (prefix: string) => ({
  [`${prefix}_OKX_API_KEY`]: opt,
  [`${prefix}_OKX_API_SECRET`]: opt,
  [`${prefix}_OKX_API_PASSPHRASE`]: opt,
  [`${prefix}_OKX_DEMO_API_KEY`]: opt,
  [`${prefix}_OKX_DEMO_API_SECRET`]: opt,
  [`${prefix}_OKX_DEMO_API_PASSPHRASE`]: opt,
});

const EnvSchema = z.object({
  // DRY_RUN=true (the default) forces MODE=dry whatever MODE says. Going to demo or live needs both DRY_RUN=false and MODE set.
  DRY_RUN: bool(true),
  MODE: z.enum(["dry", "demo", "live"]).optional().default("dry"),

  // The chooser. With a Gemini key (here or from Setup) it is Gemini 4 Argon; with only a Jev key it is Jev; with neither,
  // a deterministic code chooser (paper and demo only: MODE=live needs a key). The two keys never mix: a Jev key is never
  // sent to Google, and JEV_* never become the Gemini model or price.
  GEMINI_API_KEY: opt,
  GEMINI_MODEL: str("gemini-4-argon"),
  GEMINI_TIMEOUT_MS: num(3000),
  GEMINI_DAILY_USD_CAP: num(3),
  // Gemini 4 Argon's list price after the launch offer: $4 in / $20 out per million tokens (thinking billed as output).
  // Pricing the cap at the higher price keeps it safe during the offer too.
  GEMINI_USD_PER_MTOK: num(4),
  GEMINI_USD_PER_MTOK_OUT: num(20),
  // At most one paid call per bee per this many ms, whatever TICK_MS is; in between the bee holds.
  GEMINI_MIN_INTERVAL_MS: num(60_000),
  GEMINI_THINKING_LEVEL: opt,
  TYPESAFE_API_KEY: opt,
  LOCAL_SHADOW_ENABLED: bool(false),
  LOCAL_SHADOW_MODEL: str(LOCAL_SHADOW_RUNTIME.model),
  LOCAL_SHADOW_TRANSPORT: z.enum(["host-loopback", "unix-socket"]).optional().default("host-loopback"),
  JEV_MODEL: str("jev-1.13.0"),
  JEV_TIMEOUT_MS: num(2000),
  JEV_DAILY_USD_CAP: num(2),
  JEV_USD_PER_MTOK: num(0.042),
  TICK_MS: num(10_000),
  DATA_REFRESH_MS: num(60_000),

  OKX_SITE: z.literal("eea").optional().default("eea"),
  OKX_API_BASE: str("https://eea.okx.com"),
  OKX_CLI_TIMEOUT_MS: num(15_000),

  BEE_START_EQUITY_USD: num(333),
  MAX_LEVERAGE: num(2),
  MARGIN_MODE: z.literal("isolated").optional().default("isolated"),
  MAX_NOTIONAL_USD_PER_BEE: num(700),
  DAILY_LOSS_STOP_PCT: num(8),
  BEE_RETIRE_AT_PCT: num(40),
  MAX_FLAT_MINUTES: num(1440),
  LIVE_SIZE_MULTIPLIER: num(0.25),
  LIVE_RAMP_HOURS: num(2),
  MIN_24H_VOL_USD: num(1_000_000),
  ALLOW_NON_CRYPTO: bool(false),
  TAKER_FEE_RATE: num(0.0005),

  BREEZY_MIN_OPEN_PROB: num(0.55),
  BREEZY_MIN_SIZE_USD: num(10),
  BIZZY_SIZE_FRACTION: num(0.5),
  BIZZY_UNIVERSE_SIZE: num(8),
  BIZZY_TIME_STOP_MINUTES: num(240),
  BOOZY_CANDIDATES: num(5),
  // Defaults = Gemini 4 Argon's rules in strategies/*.md (what the original bees run since 2026-10-13).
  ...perStyle("BREEZY", { trades: 2, fee: 0.75, spread: 5, cooldown: 240, stopAtr: 2, maxFlat: 1440 }),
  ...perStyle("BIZZY", { trades: 4, fee: 1.2, spread: 5, cooldown: 30, stopAtr: 2, maxFlat: 1440 }),
  ...perStyle("BOOZY", { trades: 3, fee: 1.5, spread: 8, cooldown: 60, stopAtr: 2.5, maxFlat: 1440 }),
  ...perSlot("BEE1"),
  ...perSlot("BEE2"),
  ...perSlot("BEE3"),
  // Real money needs DRY_RUN=false, MODE=live AND this set to LIVE_ACK_PHRASE. Paper trading needs none of it.
  LIVE_ACK: opt,

  ENGINE_PORT: num(8080),
  ENGINE_BIND: str("127.0.0.1"),
  // "{mode}" is replaced with dry/demo/live, so each mode keeps its own books.
  DB_PATH: str("./data/bees-{mode}.sqlite"),
  // Written by the Setup page. Anything set in the environment wins over it.
  SETTINGS_PATH: str("./data/settings.json"),
  BEE_PROFILES_PATH: str("./data/bee-profiles.json"),
  OPENAI_API_KEY: opt,
  OPENAI_TEXT_MODEL: str("gpt-5.4-nano"),
  OPENAI_IMAGE_MODEL: str("gpt-image-2"),
  // Optional links shown on the dashboard (the "Hosted on Hostinger" chip and the "Get the code" link).
  HOST_LINK: str("https://mrc.fm/beebots"),
  REPO_LINK: str("https://github.com/imikerussell/beebots"),
  // The Hive: the public leaderboard that installs can join (paper only). Reports go to <HIVE_URL>/hive/report.
  HIVE_URL: str("https://beebots.tech"),
  // "Update available" on the dashboard: checks this repo's latest GitHub Release against APP_VERSION (set by the build).
  UPDATE_CHECK: bool(true),
  UPDATE_REPO: str("imikerussell/beebots"),
  APP_VERSION: str("dev"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
  ALERT_WEBHOOK_URL: opt,
  // The Beekeeper (keeper.ts, docs/BEEKEEPER.md). Normally connected from the dashboard (keeper.json); anything set
  // here wins. BEEKEEPER_WEBHOOK_URL is the Zap's Catch Hook; PUBLIC_URL is where the Zap finds this engine.
  BEEKEEPER_WEBHOOK_URL: opt,
  PUBLIC_URL: opt,
  PUBLIC_DOMAIN: opt,
  BEEKEEPER_EVERY_HOURS: opt,
  // Optional ramp-up from this time (ISO or unix ms): hourly for 12 h, every 2 h for 12 h, every 3 h for 12 h.
  BEEKEEPER_RAMP_START: opt,
  // Optional second key for the Beekeeper's door (lab/door.ts), for people who script their own engine. 32+ characters.
  LAB_SECRET: opt,
});

/** "https://host[:port]" from a URL with no path, query or login in it; null for anything else. */
export function originOf(v: string, schemes: readonly string[] = ["http:", "https:"]): string | null {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  if (!schemes.includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  return u.origin;
}

export interface BeeKnobs {
  maxTradesPerDay: number;
  feeBudgetUsdDay: number;
  spreadGateBps: number;
  cooldownMinutes: number;
  stopAtrMult: number;
  /** Effective max flat minutes: min(per-bee, global MAX_FLAT_MINUTES). */
  maxFlatMinutes: number;
}

export interface OkxCreds {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

/** A bee as the dashboard shows it. No secrets. */
export interface SlotProfile {
  style: StyleId;
  name: string;
  tagline: string;
  /** A portrait generated on Setup lives in the data volume. */
  customImage: boolean;
  /** The owner's rules (fed to the chooser) and coin restriction, from Setup. Empty for the original three. */
  rules: string;
  /** Profile-file instructions are shown to the owner but are not fed to the code chooser. */
  instructions?: string;
  coins: string[];
  /** Made on the Setup page (never shown with the original bees' art). */
  fromSetup: boolean;
}

export interface Config {
  mode: Mode;
  beeIds: BeeId[];
  slots: Record<BeeId, SlotProfile>;
  openai: { apiKey?: string; textModel: string; imageModel: string };
  links: { sponsor: string; code: string };
  hive: { url: string };
  update: { enabled: boolean; repo: string; version: string };
  settingsPath: string;
  /**
   * The chooser. `provider` says which model the key is for ("code" = no key, the deterministic code chooser). The name
   * "jev" stays so the engine, the DB columns and the dashboard keep working.
   */
  jev: {
    provider: ChooserProvider;
    apiKey: string;
    model: string;
    timeoutMs: number;
    dailyUsdCap: number;
    usdPerMTok: number;
    usdPerMTokOut: number;
    minIntervalMs: number;
    thinkingLevel?: string;
  };
  tickMs: number;
  dataRefreshMs: number;
  okx: { site: "eea"; apiBase: string; cliTimeoutMs: number };
  risk: {
    startEquityUsd: number;
    maxLeverage: number;
    maxNotionalUsdPerBee: number;
    dailyLossStopPct: number;
    retireAtPct: number;
    maxFlatMinutes: number;
    liveSizeMultiplier: number;
    liveRampHours: number;
    takerFeeRate: number;
  };
  universe: { min24hVolUsd: number; allowNonCrypto: boolean };
  /** Knobs per trading style. */
  bees: Record<StyleId, BeeKnobs>;
  breezy: { minOpenProb: number; minSizeUsd: number };
  bizzy: { sizeFraction: number; universeSize: number; timeStopMinutes: number };
  boozy: { candidates: number };
  /** Per-bee OKX credentials for the current mode. Never logged, never sent to the dashboard. */
  creds: Partial<Record<BeeId, OkxCreds>>;
  server: { port: number; bind: string };
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  alertWebhookUrl?: string;
  /** The Beekeeper's settings from the environment only (keeper.json fills in whatever is unset here). Never logged. */
  keeper: { hookUrl?: string; publicUrl?: string; everyHours?: number; rampStart?: string };
  /** The door's optional second key. Never logged, never sent anywhere. */
  lab: { secret?: string };
  localShadow: { enabled: boolean; transport: LocalShadowTransport; socketPath: string };
}

export type ChooserProvider = "gemini" | "jev" | "code";

/** What the dashboard and the alerts call the chooser: a short name ("Argon") and a full one ("Gemini 4 Argon"). */
export function chooserName(c: { provider: ChooserProvider; model: string }): { short: string; full: string } {
  if (c.provider === "jev") return { short: "Jev", full: "Jev" };
  if (c.provider === "code") return { short: "Code", full: "the code chooser" };
  return /^gemini-4-argon/.test(c.model) ? { short: "Argon", full: "Gemini 4 Argon" } : { short: "Gemini", full: c.model };
}

export class ConfigError extends Error {}

/** Parse and validate the environment (plus the Setup file, if any). Throws ConfigError listing NAMES only, never values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, settings: Settings | null = null): Config {
  const shadowEnabled = /^(1|true|yes|on)$/i.test(env.LOCAL_SHADOW_ENABLED?.trim() ?? "");
  const containerBind = /^(1|true|yes|on)$/i.test(env.PAPER_CONTAINER_BIND?.trim() ?? "");
  if (containerBind && shadowEnabled && (env.LOCAL_SHADOW_TRANSPORT?.trim() || "host-loopback") !== "unix-socket") {
    throw new ConfigError("PAPER_CONTAINER_BIND requires LOCAL_SHADOW_TRANSPORT=unix-socket when local shadow is enabled");
  }
  if (env.LOCAL_SHADOW_MODEL?.trim() && env.LOCAL_SHADOW_MODEL.trim() !== LOCAL_SHADOW_RUNTIME.model) {
    throw new ConfigError("LOCAL_SHADOW_MODEL is pinned by the local runtime configuration");
  }
  if (env.LOCAL_SHADOW_TRANSPORT?.trim() && !["host-loopback", "unix-socket"].includes(env.LOCAL_SHADOW_TRANSPORT.trim())) {
    throw new ConfigError("LOCAL_SHADOW_TRANSPORT must be host-loopback or unix-socket");
  }
  // This fork is permanently paper-only. Reject unsafe intent before parsing so DRY_RUN cannot mask
  // MODE=demo/live and injected credentials are never copied into Config or exposed in diagnostics.
  const unsafe: string[] = [];
  if (env.MODE?.trim() && env.MODE.trim().toLowerCase() !== "dry") unsafe.push("MODE");
  if (env.DRY_RUN?.trim() && !/^(1|true|yes|on)$/i.test(env.DRY_RUN.trim())) unsafe.push("DRY_RUN");
  if (env.LIVE_ACK?.trim()) unsafe.push("LIVE_ACK");
  if (env.OKX_API_BASE?.trim() && env.OKX_API_BASE.trim().replace(/\/+$/, "") !== "https://eea.okx.com") unsafe.push("OKX_API_BASE");
  for (const name of Object.keys(env)) {
    if (/^(?:BEE.*_OKX_|OKX_).*(?:KEY|SECRET|PASSPHRASE)$/i.test(name) && env[name]?.trim()) unsafe.push(name);
  }
  for (const name of ["GEMINI_API_KEY", "TYPESAFE_API_KEY", "OPENAI_API_KEY", "ALERT_WEBHOOK_URL", "BEEKEEPER_WEBHOOK_URL", "PUBLIC_URL", "PUBLIC_DOMAIN", "LAB_SECRET"])
    if (env[name]?.trim()) unsafe.push(name);
  if (settings?.geminiKey) unsafe.push("settings.geminiKey");
  if (settings?.jevKey) unsafe.push("settings.jevKey");
  if (settings?.openaiKey) unsafe.push("settings.openaiKey");
  if (unsafe.length) throw new ConfigError(`Paper-only fork refuses execution settings: ${[...new Set(unsafe)].join(", ")}`);
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid settings:\n  ${names.join("\n  ")}`);
  }
  const e = parsed.data as Record<string, unknown> & z.infer<typeof EnvSchema>;
  const mode: Mode = "dry";

  const provider: ChooserProvider = "code";
  // The spend cap is only as good as the prices it counts with: a zero price makes every call free and a negative one
  // gives money back, so neither may pass. Non-numbers and Infinity were already refused by num(). Names only, never values.
  const money: Array<[string, number, "positive" | "nonnegative"]> = [
    ["GEMINI_DAILY_USD_CAP", e.GEMINI_DAILY_USD_CAP, "nonnegative"],
    ["GEMINI_USD_PER_MTOK", e.GEMINI_USD_PER_MTOK, "positive"],
    ["GEMINI_USD_PER_MTOK_OUT", e.GEMINI_USD_PER_MTOK_OUT, "positive"],
    ["GEMINI_TIMEOUT_MS", e.GEMINI_TIMEOUT_MS, "positive"],
    ["JEV_DAILY_USD_CAP", e.JEV_DAILY_USD_CAP, "nonnegative"],
    ["JEV_USD_PER_MTOK", e.JEV_USD_PER_MTOK, "positive"],
    ["JEV_TIMEOUT_MS", e.JEV_TIMEOUT_MS, "positive"],
  ];
  const bad = money.filter(([, v, kind]) => !Number.isFinite(v) || (kind === "positive" ? !(v > 0) : !(v >= 0)));
  if (bad.length) {
    throw new ConfigError(`Invalid settings:\n  ${bad.map(([name, , kind]) => `${name}: must be ${kind === "positive" ? "a number above 0" : "a number, 0 or more"}`).join("\n  ")}`);
  }

  if (e.MAX_LEVERAGE > 2 || e.MAX_LEVERAGE <= 0) throw new ConfigError("MAX_LEVERAGE must be in (0, 2]. Hard rule 3.");
  if (e.MAX_FLAT_MINUTES < 0) throw new ConfigError("MAX_FLAT_MINUTES must be >= 0");
  if (e.BEEKEEPER_WEBHOOK_URL && !/^https:\/\//.test(e.BEEKEEPER_WEBHOOK_URL)) throw new ConfigError("BEEKEEPER_WEBHOOK_URL must start with https://");
  const everyHours = e.BEEKEEPER_EVERY_HOURS === undefined ? undefined : Number(e.BEEKEEPER_EVERY_HOURS);
  if (everyHours !== undefined && !(everyHours >= 0.25)) throw new ConfigError("BEEKEEPER_EVERY_HOURS must be a number, at least 0.25");
  if (e.PUBLIC_URL && !originOf(e.PUBLIC_URL)) throw new ConfigError("PUBLIC_URL must look like https://your-domain or http://your-server-ip (no path)");
  let profileRows;
  try { profileRows = existsSync(e.BEE_PROFILES_PATH) ? readProfiles(e.BEE_PROFILES_PATH).profiles : null; }
  catch (err) { throw new ConfigError(`Invalid bee profiles: ${err instanceof Error ? err.message : "profile validation failed"}`); }
  const activeProfiles = profileRows?.filter((p) => p.active);
  const beeIds = (activeProfiles?.map((p) => p.id) ?? [...BEES]) as unknown as BeeId[];
  const slots = {} as Record<BeeId, SlotProfile>;
  beeIds.forEach((id) => {
    const legacyIndex = (BEES as readonly string[]).indexOf(id);
    const configured = activeProfiles?.find((p) => p.id === id);
    const b = legacyIndex >= 0 ? settings?.bees[legacyIndex] : undefined;
    const style = configured?.style ?? b?.style ?? (DEFAULT_SLOTS as Record<string, StyleId>)[id]!;
    slots[id] = configured
      ? { style, name: configured.name, tagline: b?.tagline ?? STYLE_INFO[style].tagline, customImage: legacyIndex >= 0 && !!b?.image, rules: "", instructions: configured.rules, coins: configured.coins, fromSetup: false }
      : b
      ? { style, name: b.name, tagline: b.tagline, customImage: b.image, rules: b.rules, coins: b.coins, fromSetup: true }
      : { style, name: STYLE_INFO[style].name, tagline: STYLE_INFO[style].tagline, customImage: false, rules: "", coins: [], fromSetup: false };
  });

  const knobs = (style: StyleId): BeeKnobs => {
    const p = style.toUpperCase();
    const n = (k: string) => e[`${p}_${k}`] as number;
    return {
      maxTradesPerDay: n("MAX_TRADES_PER_DAY"),
      feeBudgetUsdDay: n("FEE_BUDGET_USD_DAY"),
      spreadGateBps: n("SPREAD_GATE_BPS"),
      cooldownMinutes: n("COOLDOWN_MINUTES"),
      stopAtrMult: n("STOP_ATR_MULT"),
      maxFlatMinutes: Math.min(n("MAX_FLAT_MINUTES"), e.MAX_FLAT_MINUTES),
    };
  };

  return {
    mode,
    localShadow: { enabled: e.LOCAL_SHADOW_ENABLED, transport: e.LOCAL_SHADOW_TRANSPORT, socketPath: LOCAL_SHADOW_SOCKET_PATH },
    beeIds,
    slots,
    openai: { textModel: e.OPENAI_TEXT_MODEL, imageModel: e.OPENAI_IMAGE_MODEL },
    links: { sponsor: e.HOST_LINK, code: e.REPO_LINK },
    hive: { url: "" },
    update: { enabled: false, repo: e.UPDATE_REPO, version: e.APP_VERSION },
    settingsPath: e.SETTINGS_PATH,
    jev: {
            provider,
            apiKey: "",
            model: "code",
            timeoutMs: e.GEMINI_TIMEOUT_MS,
            dailyUsdCap: e.GEMINI_DAILY_USD_CAP,
            usdPerMTok: e.GEMINI_USD_PER_MTOK,
            usdPerMTokOut: e.GEMINI_USD_PER_MTOK_OUT,
            minIntervalMs: Math.max(0, e.GEMINI_MIN_INTERVAL_MS),
            ...(e.GEMINI_THINKING_LEVEL ? { thinkingLevel: e.GEMINI_THINKING_LEVEL } : {}),
          },
    tickMs: Math.max(1000, e.TICK_MS),
    dataRefreshMs: Math.max(15_000, e.DATA_REFRESH_MS),
    okx: { site: e.OKX_SITE, apiBase: e.OKX_API_BASE.replace(/\/+$/, ""), cliTimeoutMs: e.OKX_CLI_TIMEOUT_MS },
    risk: {
      startEquityUsd: e.BEE_START_EQUITY_USD,
      maxLeverage: e.MAX_LEVERAGE,
      maxNotionalUsdPerBee: e.MAX_NOTIONAL_USD_PER_BEE,
      dailyLossStopPct: e.DAILY_LOSS_STOP_PCT,
      retireAtPct: e.BEE_RETIRE_AT_PCT,
      maxFlatMinutes: e.MAX_FLAT_MINUTES,
      liveSizeMultiplier: e.LIVE_SIZE_MULTIPLIER,
      liveRampHours: e.LIVE_RAMP_HOURS,
      takerFeeRate: e.TAKER_FEE_RATE,
    },
    universe: { min24hVolUsd: e.MIN_24H_VOL_USD, allowNonCrypto: e.ALLOW_NON_CRYPTO },
    bees: { bizzy: knobs("bizzy"), breezy: knobs("breezy"), boozy: knobs("boozy") },
    breezy: { minOpenProb: e.BREEZY_MIN_OPEN_PROB, minSizeUsd: e.BREEZY_MIN_SIZE_USD },
    bizzy: { sizeFraction: e.BIZZY_SIZE_FRACTION, universeSize: e.BIZZY_UNIVERSE_SIZE, timeStopMinutes: e.BIZZY_TIME_STOP_MINUTES },
    boozy: { candidates: e.BOOZY_CANDIDATES },
    creds: {},
    server: { port: e.ENGINE_PORT, bind: env.NODE_ENV === "production" && env.PAPER_CONTAINER_BIND === "true" ? "0.0.0.0" : "127.0.0.1" },
    dbPath: e.DB_PATH.replaceAll("{mode}", mode),
    logLevel: e.LOG_LEVEL,
    alertWebhookUrl: undefined,
    keeper: { everyHours },
    lab: {},
  };
}
