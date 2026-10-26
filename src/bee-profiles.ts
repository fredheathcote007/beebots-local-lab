import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isReservedName, STYLE_INFO, STYLES, type StyleId } from "./settings.js";

/** Owner-managed v2 paper runtime profiles. */
export const MAX_PROFILES = 16;
export const MIN_ACTIVE_PROFILES = 3;
const ProfileSchema = z.object({
  id: z.string().regex(/^bee[1-3]$|^bee_[0-9a-f-]{36}$/),
  name: z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N} .'_-]+$/u),
  style: z.enum(STYLES),
  rules: z.string().max(500),
  coins: z.array(z.string().regex(/^[A-Z0-9]{1,15}$/)).max(20),
  active: z.boolean(),
}).strict();
const ProfilesSchema = z.object({ version: z.literal(2), profiles: z.array(ProfileSchema).min(3).max(MAX_PROFILES) }).strict();
export type BeeProfile = z.infer<typeof ProfileSchema>;
export type BeeProfiles = z.infer<typeof ProfilesSchema>;

export function defaultProfiles(): BeeProfiles {
  return { version: 2, profiles: [
    { id: "bee1", name: "Bizzy", style: "bizzy", rules: "", coins: [], active: true },
    { id: "bee2", name: "Breezy", style: "breezy", rules: "", coins: [], active: true },
    { id: "bee3", name: "Boozy", style: "boozy", rules: "", coins: [], active: true },
  ] };
}

export function readProfiles(path: string): BeeProfiles {
  assertNoSymlinks(path);
  if (!existsSync(path)) return defaultProfiles();
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Profile file is not valid JSON; it was left unchanged."); }
  const parsed = ProfilesSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Profile file is invalid (version 2 required; fields: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}). It was left unchanged.`);
  readProfilesForValidation(parsed.data);
  return parsed.data;
}

export function saveProfiles(path: string, profiles: BeeProfiles): void {
  const validated = ProfilesSchema.parse(profiles);
  readProfilesForValidation(validated);
  assertNoSymlinks(path);
  const abs = resolve(path), tmp = `${abs}.${process.pid}.tmp`;
  mkdirSync(dirname(abs), { recursive: true });
  try {
    writeFileSync(tmp, JSON.stringify(validated, null, 2), { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, abs);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* no temp file */ }
    throw err;
  }
}
function readProfilesForValidation(v: BeeProfiles) {
  const ids = v.profiles.map((p) => p.id), names = v.profiles.map((p) => p.name.toLocaleLowerCase());
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) throw new Error("Profile IDs and names must be unique.");
  if (v.profiles.some((p) => !official(p) && isReservedName(p.name))) throw new Error("Names matching Bizzy, Breezy, or Boozy are reserved.");
  for (const id of ["bee1", "bee2", "bee3"] as const) {
    const profile = v.profiles.find((p) => p.id === id);
    if (!profile || !profile.active) throw new Error(`${id} must be present and active; the original three paper portfolios are permanent.`);
  }
  if (v.profiles.filter((p) => p.active).length < MIN_ACTIVE_PROFILES) throw new Error("At least three profiles must remain active.");
}

export function newProfile(name: string, style: StyleId, source?: BeeProfile): BeeProfile {
  return { id: `bee_${randomUUID()}`, name, style, rules: source?.rules ?? "", coins: [...(source?.coins ?? [])], active: true };
}

export function profileSummary(p: BeeProfile): string {
  const coinText = p.coins.length ? p.coins.join(",") : "any allowed by style";
  return `${p.id}\t${p.name}\t${p.style}\t${p.active ? "active" : "archived"}\tcoins=${coinText}`;
}

export function defaultStyleName(style: StyleId): string { return STYLE_INFO[style].name; }
function official(p: BeeProfile) { return (p.id === "bee1" && p.name === "Bizzy") || (p.id === "bee2" && p.name === "Breezy") || (p.id === "bee3" && p.name === "Boozy"); }

function assertNoSymlinks(path: string) {
  const abs = resolve(path);
  let current = abs;
  while (current !== dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error("Profile path cannot contain symlinks."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    current = dirname(current);
  }
  if (existsSync(abs) && realpathSync(abs) !== abs) throw new Error("Profile path must resolve to itself.");
}
