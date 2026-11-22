import { readFile } from "node:fs/promises";

export interface VersionEntry {
  version: string;
  image: string;
  releasedAt?: string;
  notes?: string;
}

export interface VersionManifest {
  latest: string;
  versions: VersionEntry[];
}

export interface VersionStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  versions: VersionEntry[];
  checkedAt: string | null;
}

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,31}$/i;
const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;

let cachedVersion: string | null = null;
let manifestCache: { fetchedAt: number; manifest: VersionManifest | null } | null = null;

export async function currentVersion(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const override = env.TOASTY_VERSION?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  if (cachedVersion !== null) {
    return cachedVersion;
  }
  try {
    const raw = await readFile(new URL("../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      cachedVersion = parsed.version;
    }
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion ?? "0.0.0";
}

export function compareVersions(a: string, b: string): number {
  const split = (value: string): { core: Array<string | number>; pre: string | null } => {
    let trimmed = value.trim();
    const build = trimmed.indexOf("+");
    if (build !== -1) trimmed = trimmed.slice(0, build);
    const cut = trimmed.indexOf("-");
    const core = cut === -1 ? trimmed : trimmed.slice(0, cut);
    const pre = cut === -1 ? null : trimmed.slice(cut + 1);
    return {
      core: core.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      pre: pre === null || pre.length === 0 ? null : pre,
    };
  };
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.core[i] ?? 0;
    const r = right.core[i] ?? 0;
    if (typeof l === "number" && typeof r === "number") {
      if (l !== r) return l < r ? -1 : 1;
      continue;
    }
    const ls = String(l);
    const rs = String(r);
    if (ls !== rs) return ls < rs ? -1 : 1;
  }
  if (left.pre === null && right.pre === null) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre === right.pre ? 0 : left.pre < right.pre ? -1 : 1;
}

function parseManifest(data: unknown): VersionManifest | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const rawVersions = Array.isArray(record.versions) ? record.versions : null;
  if (rawVersions === null) return null;
  const versions: VersionEntry[] = [];
  for (const entry of rawVersions) {
    if (typeof entry !== "object" || entry === null) continue;
    const fields = entry as Record<string, unknown>;
    if (typeof fields.version !== "string" || typeof fields.image !== "string") continue;
    if (!VERSION_PATTERN.test(fields.version)) continue;
    const normalized: VersionEntry = {
      version: fields.version,
      image: fields.image.trim(),
    };
    if (typeof fields.releasedAt === "string") normalized.releasedAt = fields.releasedAt;
    if (typeof fields.notes === "string") normalized.notes = fields.notes;
    versions.push(normalized);
  }
  versions.sort((a, b) => compareVersions(b.version, a.version));
  const latest =
    typeof record.latest === "string" && VERSION_PATTERN.test(record.latest)
      ? record.latest
      : (versions[0]?.version ?? null) ?? "";
  return { latest, versions };
}

async function fetchManifest(url: string): Promise<VersionManifest | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseManifest(await response.json());
  } catch {
    return null;
  }
}

export async function loadManifest(options: {
  manifestUrl: string | null;
  checkEnabled: boolean;
  now?: number;
}): Promise<{ manifest: VersionManifest | null; checkedAt: string | null }> {
  if (!options.checkEnabled || options.manifestUrl === null) {
    return { manifest: null, checkedAt: null };
  }
  const now = options.now ?? Date.now();
  if (manifestCache !== null && now - manifestCache.fetchedAt < MANIFEST_TTL_MS) {
    return {
      manifest: manifestCache.manifest,
      checkedAt: new Date(manifestCache.fetchedAt).toISOString(),
    };
  }
  const manifest = await fetchManifest(options.manifestUrl);
  manifestCache = { fetchedAt: now, manifest };
  return { manifest, checkedAt: new Date(now).toISOString() };
}

export async function versionStatus(options: {
  manifestUrl: string | null;
  checkEnabled: boolean;
}): Promise<VersionStatus> {
  const current = await currentVersion();
  const { manifest, checkedAt } = await loadManifest(options);
  const latest = manifest?.latest ?? null;
  return {
    current,
    latest,
    updateAvailable: latest !== null && compareVersions(latest, current) > 0,
    versions: manifest?.versions ?? [],
    checkedAt,
  };
}

export function resolveImageRef(entry: VersionEntry, repoOverride: string | null): string {
  if (repoOverride === null) return entry.image;
  const separator = entry.image.lastIndexOf(":");
  const tag = separator > entry.image.lastIndexOf("/") ? entry.image.slice(separator + 1) : entry.version;
  return `${repoOverride}:${tag}`;
}
