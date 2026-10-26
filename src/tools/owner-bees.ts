#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { readProfiles, saveProfiles, newProfile, profileSummary, type BeeProfile, type BeeProfiles } from "../bee-profiles.js";
import { STYLES, type StyleId } from "../settings.js";

const args = process.argv.slice(2);
let path = resolve(process.env.BEE_PROFILES_PATH?.trim() || "./data/bee-profiles.json");
if (args[0] === "--file") {
  if (!args[1] || args[1]!.startsWith("--")) usage();
  if (!isAbsolute(args[1]!)) {
    console.error("--file must be an absolute path. In Docker, use /data/bee-profiles.json.");
    usage();
  }
  path = resolve(args[1]!); args.splice(0, 2);
}
const [command, ...rest] = args;
const fail = (message: string): never => { console.error(message); process.exitCode = 1; throw new Error("owner CLI failed"); };
function usage(): never {
  console.error(`Usage: pnpm owner:bees [--file ABSOLUTE_PATH] <command>

Commands:
  list
  show <id>
  create '<name>' <bizzy|breezy|boozy>
  clone <id> '<new-name>'
  edit-instructions <id> <plain text>
  update-coins <id> <comma-separated tickers|any>
  update-style <id> <bizzy|breezy|boozy>
  archive <id>

Docker volume command:
  docker compose exec -T engine node dist/tools/owner-bees.js --file /data/bee-profiles.json list

The profile path rejects symlinks. Changes take effect after an engine restart.
Instructions are plain-text prompt data for the optional local shadow only; the deterministic chooser ignores them.`);
  process.exit(2);
}
if (!command) usage();
function count(n: number) { if (rest.length !== n) usage(); }
function find(ps: BeeProfiles, id: string): BeeProfile { const b = ps.profiles.find((p) => p.id === id); if (!b) fail(`No profile with id ${id}.`); return b!; }
function checkStyle(s: string): StyleId { if (!(STYLES as readonly string[]).includes(s)) fail("Style must be bizzy, breezy, or boozy."); return s as StyleId; }
function write(ps: BeeProfiles) { saveProfiles(path, ps); console.log(`Saved ${path} (0600). Restart the engine to apply profile changes.`); }
try {
  const ps = readProfiles(path);
  switch (command) {
    case "list": count(0); for (const b of ps.profiles) console.log(profileSummary(b)); break;
    case "show": { count(1); const b = find(ps, rest[0]!); console.log(JSON.stringify({ ...b, rulesNote: "Plain-language notes only; the deterministic chooser does not interpret them." }, null, 2)); break; }
    case "create": {
      count(2); if (ps.profiles.length >= 16) fail("Maximum of 16 profiles reached.");
      const style = checkStyle(rest[1]!); const b = newProfile(rest[0]!, style);
      ps.profiles.push(b); write(ps); console.log(`Created ${b.id}. Instructions are owner notes; coin restrictions are enforced by the paper runtime.`); break;
    }
    case "clone": {
      count(2); if (ps.profiles.length >= 16) fail("Maximum of 16 profiles reached.");
      const src = find(ps, rest[0]!); const b = newProfile(rest[1]!, src.style, src);
      ps.profiles.push(b); write(ps); console.log(`Cloned ${src.id} as ${b.id}.`); break;
    }
    case "edit-instructions": {
      if (rest.length < 2) usage(); const b = find(ps, rest[0]!); b.rules = rest.slice(1).join(" ");
      write(ps); console.log("Natural-language notes saved for optional local shadow prompt data. The deterministic chooser does not interpret them."); break;
    }
    case "update-coins": {
      count(2); const b = find(ps, rest[0]!); const v = rest[1]!.toLowerCase() === "any" ? [] : rest[1]!.split(",").map((x) => x.trim().toUpperCase());
      if (v.some((x) => !/^[A-Z0-9]{1,15}$/.test(x)) || new Set(v).size !== v.length) fail("Coins must be unique comma-separated ticker symbols, or 'any'.");
      b.coins = v; write(ps); console.log("Coin restriction saved."); break;
    }
    case "update-style": { count(2); find(ps, rest[0]!).style = checkStyle(rest[1]!); write(ps); break; }
    case "archive": {
      count(1); const b = find(ps, rest[0]!); if (["bee1", "bee2", "bee3"].includes(b.id)) fail("The original three profiles cannot be archived.");
      b.active = false; write(ps); console.log("Archived. Restart will be refused if this bee has an open paper position."); break;
    }
    default: usage();
  }
} catch (e) {
  if (e instanceof Error && e.message === "owner CLI failed") process.exit(1);
  console.error(e instanceof Error ? e.message : "Unable to update profiles."); process.exit(1);
}
