export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: string[] | "*";
  staticDir: string | null;
  sessionTtlHours: number;
  sessionMaxRefreshes: number;
  rateLimitAuthPerMinute: number;
  trustProxy: boolean;
  migrateOnBoot: boolean;
  allowRegistration: boolean;
  updateCheck: boolean;
  updateManifestUrl: string | null;
  updaterUrl: string | null;
  updateImageRepo: string | null;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_CORS_ORIGIN = "http://localhost:5173";
const DEFAULT_RATE_LIMIT_AUTH_PER_MINUTE = 10;
const DEFAULT_UPDATE_MANIFEST_URL = "https://toasty.stary.lol/versions.json";

function readString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = readString(env, name);
  if (raw === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(raw);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const raw = readString(env, name)?.toLowerCase();
  if (raw === undefined) {
    return defaultValue;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function readCorsOrigins(value: string | undefined): string[] | "*" {
  if (value === undefined) {
    return [DEFAULT_CORS_ORIGIN];
  }
  if (value === "*") {
    return "*";
  }
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) {
    throw new Error("CORS_ORIGIN must be * or a comma-separated list of origins");
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = readString(env, "DATABASE_URL");
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  return {
    port: readInteger(env, "PORT", DEFAULT_PORT, 1, 65535),
    host: readString(env, "HOST") ?? DEFAULT_HOST,
    databaseUrl,
    corsOrigins: readCorsOrigins(readString(env, "CORS_ORIGIN")),
    staticDir: readString(env, "STATIC_DIR") ?? null,
    sessionTtlHours: readInteger(env, "SESSION_TTL_HOURS", 24, 1, 720),
    sessionMaxRefreshes: readInteger(env, "SESSION_MAX_REFRESHES", 3, 0, 100),
    rateLimitAuthPerMinute: readInteger(
      env,
      "RATE_LIMIT_AUTH_PER_MINUTE",
      DEFAULT_RATE_LIMIT_AUTH_PER_MINUTE,
      1,
      100000,
    ),
    trustProxy: readBoolean(env, "TRUST_PROXY", false),
    migrateOnBoot: readBoolean(env, "MIGRATE_ON_BOOT", true),
    allowRegistration: readBoolean(env, "ALLOW_REGISTRATION", false),
    updateCheck: readBoolean(env, "UPDATE_CHECK", true),
    updateManifestUrl:
      readString(env, "UPDATE_MANIFEST_URL") ?? DEFAULT_UPDATE_MANIFEST_URL,
    updaterUrl: readString(env, "UPDATER_URL") ?? null,
    updateImageRepo: readString(env, "UPDATE_IMAGE_REPO") ?? null,
  };
}
