import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Alerts } from "./alerts.js";
import { BREEZY_COINS } from "./bees/breezy.js";
import { ConfigError, loadConfig, STYLES, type Config } from "./config.js";
import { Db } from "./db.js";
import { Engine } from "./engine.js";
import { EventBus } from "./events.js";
import { liveRules } from "./lab/brain.js";
import { LabStore } from "./lab/store.js";
import { SimExecutor } from "./exec/executor.js";
import { Jev } from "./jev.js";
import { LocalShadow } from "./local-shadow.js";
import { log, setLogLevel } from "./log.js";
import { MarketFeed } from "./market/data.js";
import { createPublicApi } from "./okx/public.js";
import { createOkxPublicRest } from "./okx/rest.js";
import { safeError } from "./redact.js";
import { startServer } from "./server.js";
import { loadSettings, STYLE_INFO } from "./settings.js";
import { imagePath } from "./setup.js";
import { UpdateCheck } from "./update.js";
import { Visitors } from "./visitors.js";

const SETTINGS_PATH = process.env.SETTINGS_PATH?.trim() || "./data/settings.json";

/** Names, rules, styles and pictures for the dashboard. The rules and coins are the ones each bee trades on right now. */
function profile(cfg: Config | null, lab?: LabStore) {
  return {
    setup: cfg === null,
    mode: cfg?.mode ?? "dry",
    links: cfg?.links ?? null,
    bees: cfg
      ? cfg.beeIds.map((id) => {
          const s = cfg.slots[id];
          const live = liveRules(s, lab?.overlay(id) ?? null);
          return {
            id,
            name: s.name,
            tagline: s.tagline,
            style: s.style,
            styleLabel: STYLE_INFO[s.style].label,
            rules: s.instructions || s.rules || "",
            coins: live.coins,
            // A Setup-made bee only ever shows its own portrait (null = the dashboard's placeholder mark), never the
            // original bees' art, which belongs to the three official bees.
            img: s.customImage && imagePath(cfg.settingsPath, id) ? `/bee-image/${id}` : s.fromSetup || !["bee1", "bee2", "bee3"].includes(id) ? null : `/bees/${s.style}.jpg`,
          };
        })
      : [],
  };
}

async function main() {
  const settings = loadSettings(SETTINGS_PATH);
  let cfg;
  try {
    cfg = loadConfig({ ...process.env, SETTINGS_PATH }, settings);
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error("refusing to start", { reason: err.message });
      process.exit(1);
    }
    throw err;
  }
  setLogLevel(cfg.logLevel);
  log.info("beebots engine starting", { mode: cfg.mode, tickMs: cfg.tickMs, dataRefreshMs: cfg.dataRefreshMs, chooser: cfg.jev.provider, model: cfg.jev.model });

  const db = new Db(cfg.dbPath);
  const bus = new EventBus(db);
  const alerts = new Alerts(cfg.alertWebhookUrl);
  // The production entrypoint has no signed client, exchange executor, credentials or demo data mode.
  const api = createPublicApi(cfg.okx.apiBase, false, createOkxPublicRest({ apiBase: cfg.okx.apiBase, timeoutMs: cfg.okx.cliTimeoutMs }));

  let engine: Engine | null = null;
  const held = () => (engine ? cfg.beeIds.map((id) => engine!.bees[id]?.position?.instId).filter((x): x is string => !!x) : []);
  const news = null;
  const feed = new MarketFeed(
    api,
    {
      min24hVolUsd: cfg.universe.min24hVolUsd,
      allowNonCrypto: cfg.universe.allowNonCrypto,
      spreadGateBps: Math.max(...STYLES.map((s) => cfg.bees[s].spreadGateBps)),
      trendCoins: [...BREEZY_COINS],
    },
    news,
    held,
  );

  const exec = new SimExecutor(() => feed.view(), cfg.risk.takerFeeRate);

  const startOfDay = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  // Today's chooser spend survives a restart: the decisions' recorded cost, or the reservation ledger (which also holds
  // calls a restart cut off, at their worst case), whichever is higher.
  const jev = new Jev({ ...cfg.jev, spentTodayUsd: Math.max(db.jevSpendSince(startOfDay), db.chooserSpendSince(startOfDay)), ledger: db });
  const shadow = new LocalShadow({ enabled: cfg.localShadow.enabled, maxMarketAgeMs: 3 * cfg.dataRefreshMs + 30_000, onRecord: (row) => {
    db.insertShadowDecision({ bee: row.bee, ts: row.ts, marketTs: row.marketTs, model: row.model, choice: row.choice, probabilities: row.probabilities, baselineChoice: row.baselineChoice, status: row.status, reason: row.reason, latencyMs: row.latencyMs });
    log.info("local shadow outcome", { bee: row.bee, status: row.status, ...(row.reason ? { reason: row.reason } : {}), latencyMs: row.latencyMs });
  } });

  // `deploy/close.sh` drops this file into the data volume to end the experiment cleanly (see Engine.windDown).
  const closeFlag = join(dirname(cfg.dbPath), `close-${cfg.mode}`);
  // Dry run only: `resume-last-dry` puts benched, flat bees back into their last position (consumed on use).
  const resumeFlag = join(dirname(cfg.dbPath), `resume-last-${cfg.mode}`);
  const takeResumeRequest = () => {
    if (cfg.mode !== "dry" || !existsSync(resumeFlag)) return false;
    unlinkSync(resumeFlag);
    return true;
  };
  // The Beekeeper's rewrites (rules text + coins per bee) live in the engine DB and apply on the next tick.
  const labStore = new LabStore(db);
  // Previous Beekeeper integrations are dormant in this local-only runtime.
  engine = new Engine({ cfg, db, feed, jev, shadow, exec, bus, alerts, closeRequested: () => existsSync(closeFlag), takeResumeRequest, lab: labStore });
  await engine.start();


  // "Update available" on the dashboard (checks GitHub Releases; never installs anything).
  const updates = new UpdateCheck({ repo: cfg.update.repo, current: cfg.update.version, enabled: cfg.update.enabled });
  updates.start();

  const server = startServer(
    {
      engine: { bus, db, visitors: new Visitors(db), snapshot: () => engine!.snapshot(), health: () => engine!.health(), update: () => updates.status() },
      profile: () => profile(cfg, labStore),
      beeImage: (b) => (cfg.slots[b as keyof typeof cfg.slots]?.customImage ? imagePath(cfg.settingsPath, b) : null),
    },
    cfg.server.port,
    cfg.server.bind,
  );

  const shutdown = (sig: string) => {
    log.info("shutting down", { sig });
    engine?.stop();
    updates.stop();
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal", { err: safeError(err) });
  process.exit(1);
});
