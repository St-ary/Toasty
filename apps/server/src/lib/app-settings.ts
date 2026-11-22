import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "../db.js";

export async function getOrCreateSetting(key: string, generate: () => string): Promise<string> {
  const existing = await query<{ value: string }>(
    "select value from app_settings where key = $1",
    [key],
  );
  const found = existing[0]?.value;
  if (found !== undefined) {
    return found;
  }
  const value = generate();
  await query("insert into app_settings (key, value) values ($1, $2) on conflict do nothing", [
    key,
    value,
  ]);
  const rows = await query<{ value: string }>(
    "select value from app_settings where key = $1",
    [key],
  );
  return rows[0]?.value ?? value;
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ count: string }>("select count(*)::text as count from users");
  return Number(rows[0]?.count ?? "0");
}

export function ensureSetupToken(): Promise<string> {
  return getOrCreateSetting("setup_token", () => randomBytes(24).toString("base64url"));
}

export async function verifySetupToken(candidate: string): Promise<boolean> {
  const expected = await ensureSetupToken();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
