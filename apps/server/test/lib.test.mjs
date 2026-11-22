import assert from "node:assert/strict";
import test from "node:test";
import { hashAuthKey, verifyAuthKey } from "../dist/lib/password.js";
import { FailureThrottle, RateLimiter } from "../dist/lib/rate-limit.js";
import { createSessionToken, hashToken } from "../dist/lib/tokens.js";
import { compareVersions, resolveImageRef } from "../dist/lib/version.js";

const HASH_PATTERN = /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX_PATTERN = /^[0-9a-f]{64}$/;

test("hashAuthKey produces the scrypt hash format", async () => {
  const hash = await hashAuthKey("super-secret-auth-key");
  assert.match(hash, HASH_PATTERN);
});

test("hashAuthKey round trips through verifyAuthKey", async () => {
  const authKey = "another-secret-auth-key";
  const hash = await hashAuthKey(authKey);
  assert.equal(await verifyAuthKey(authKey, hash), true);
});

test("verifyAuthKey rejects a wrong password", async () => {
  const hash = await hashAuthKey("right-password");
  assert.equal(await verifyAuthKey("wrong-password", hash), false);
});

test("verifyAuthKey rejects a malformed stored hash", async () => {
  assert.equal(await verifyAuthKey("anything", "not-a-hash"), false);
  assert.equal(await verifyAuthKey("anything", ""), false);
});

test("hashAuthKey salts each hash independently", async () => {
  const authKey = "same-input";
  const first = await hashAuthKey(authKey);
  const second = await hashAuthKey(authKey);
  assert.notEqual(first, second);
  assert.equal(await verifyAuthKey(authKey, first), true);
  assert.equal(await verifyAuthKey(authKey, second), true);
});

test("createSessionToken returns 32 random bytes as base64url", () => {
  const token = createSessionToken();
  assert.match(token, TOKEN_PATTERN);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(createSessionToken(), createSessionToken());
});

test("hashToken is stable and differs per token", () => {
  const token = createSessionToken();
  const hash = hashToken(token);
  assert.match(hash, HEX_PATTERN);
  assert.equal(hashToken(token), hash);
  assert.notEqual(hash, token);
  assert.notEqual(hashToken(createSessionToken()), hash);
});

test("RateLimiter allows N requests then blocks", () => {
  const limiter = new RateLimiter(3, 60000);
  assert.equal(limiter.check("1.2.3.4"), true);
  assert.equal(limiter.check("1.2.3.4"), true);
  assert.equal(limiter.check("1.2.3.4"), true);
  assert.equal(limiter.check("1.2.3.4"), false);
  assert.equal(limiter.check("1.2.3.4"), false);
});

test("RateLimiter tracks keys independently", () => {
  const limiter = new RateLimiter(1, 60000);
  assert.equal(limiter.check("1.2.3.4"), true);
  assert.equal(limiter.check("1.2.3.4"), false);
  assert.equal(limiter.check("5.6.7.8"), true);
});

test("RateLimiter resets after the window", async () => {
  const limiter = new RateLimiter(1, 20);
  assert.equal(limiter.check("key"), true);
  assert.equal(limiter.check("key"), false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(limiter.check("key"), true);
});

test("FailureThrottle locks after max failures and doubles the lock", () => {
  let clock = 1_000_000;
  const throttle = new FailureThrottle(3, 60_000, 900_000, () => clock);
  assert.equal(throttle.lockedForMs("user"), 0);
  throttle.fail("user");
  throttle.fail("user");
  assert.equal(throttle.lockedForMs("user"), 0);
  assert.equal(throttle.fail("user"), 60_000);
  clock += 30_000;
  assert.equal(throttle.lockedForMs("user"), 30_000);
  clock += 30_000;
  assert.equal(throttle.fail("user"), 120_000);
});

test("FailureThrottle caps the lock at maxLockMs", () => {
  let clock = 0;
  const throttle = new FailureThrottle(1, 60_000, 90_000, () => clock);
  throttle.fail("user");
  throttle.fail("user");
  assert.equal(throttle.fail("user"), 90_000);
});

test("FailureThrottle clears on success and decays when idle", () => {
  let clock = 0;
  const throttle = new FailureThrottle(2, 60_000, 900_000, () => clock, 3_600_000);
  throttle.fail("user");
  throttle.fail("user");
  assert.ok(throttle.lockedForMs("user") > 0);
  throttle.succeed("user");
  assert.equal(throttle.lockedForMs("user"), 0);

  throttle.fail("other");
  clock += 3_600_001;
  throttle.fail("other");
  assert.equal(throttle.lockedForMs("other"), 0);
});

test("compareVersions orders releases numerically", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.1", "0.1.0"), 1);
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.1"), 1);
});

test("resolveImageRef keeps or overrides the repository", () => {
  const entry = { version: "0.2.0", image: "ghcr.io/stary/toasty:0.2.0" };
  assert.equal(resolveImageRef(entry, null), "ghcr.io/stary/toasty:0.2.0");
  assert.equal(resolveImageRef(entry, "toasty"), "toasty:0.2.0");
  const untagged = { version: "0.3.0", image: "ghcr.io/stary/toasty" };
  assert.equal(resolveImageRef(untagged, "toasty"), "toasty:0.3.0");
});
