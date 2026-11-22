import type { IncomingMessage } from "node:http";

interface RateWindow {
  count: number;
  resetAt: number;
}

const SWEEP_THRESHOLD = 10000;

export class RateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error("windowMs must be positive");
    }
  }

  check(key: string): boolean {
    const now = Date.now();
    if (this.windows.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }
    const entry = this.windows.get(key);
    if (entry === undefined || now >= entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) {
      return false;
    }
    entry.count += 1;
    return true;
  }

  retryAfterSeconds(key: string): number {
    const entry = this.windows.get(key);
    if (entry === undefined) {
      return 0;
    }
    return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header[0] : header;
    const first = raw?.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

interface FailureEntry {
  failures: number;
  lockedUntil: number;
  lastAt: number;
}

export class FailureThrottle {
  private readonly entries = new Map<string, FailureEntry>();

  constructor(
    private readonly maxFailures: number,
    private readonly baseLockMs: number,
    private readonly maxLockMs: number,
    private readonly now: () => number = Date.now,
    private readonly decayMs: number = 3_600_000,
  ) {
    if (maxFailures < 1) throw new Error("maxFailures must be positive");
    if (baseLockMs <= 0 || maxLockMs < baseLockMs) {
      throw new Error("lock durations are invalid");
    }
    if (decayMs <= 0) throw new Error("decayMs must be positive");
  }

  lockedForMs(key: string): number {
    const entry = this.entries.get(key);
    if (entry === undefined) return 0;
    return Math.max(0, entry.lockedUntil - this.now());
  }

  fail(key: string): number {
    const now = this.now();
    const previous = this.entries.get(key);
    const entry: FailureEntry =
      previous !== undefined && now - previous.lastAt <= this.decayMs
        ? previous
        : { failures: 0, lockedUntil: 0, lastAt: now };
    entry.failures += 1;
    entry.lastAt = now;
    if (entry.failures >= this.maxFailures) {
      const over = entry.failures - this.maxFailures;
      const lockMs = Math.min(this.baseLockMs * 2 ** over, this.maxLockMs);
      entry.lockedUntil = now + lockMs;
    }
    if (this.entries.size > 10000) {
      for (const [other, otherEntry] of this.entries) {
        if (now - otherEntry.lastAt > this.decayMs && other !== key) {
          this.entries.delete(other);
        }
      }
    }
    this.entries.set(key, entry);
    return this.lockedForMs(key);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }
}
