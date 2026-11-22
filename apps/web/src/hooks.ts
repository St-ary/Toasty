import { useEffect, useState } from "react";
import { computeTotp, parseTotpSettings, totpSecondsRemaining } from "@toasty/crypto";
import { api } from "./lib/api";
import type { VersionStatusResponse } from "./lib/api";

export const TOTP_PERIOD_SECONDS = 30;

let versionCache: VersionStatusResponse | null = null;

export function useVersionInfo(): {
  info: VersionStatusResponse | null;
  refresh: () => void;
} {
  const [info, setInfo] = useState<VersionStatusResponse | null>(versionCache);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getVersion()
      .then((response) => {
        versionCache = response;
        if (!cancelled) setInfo(response);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { info, refresh: () => setNonce((current) => current + 1) };
}

export function useNowMs(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}

export interface TotpState {
  code: string | null;
  secondsRemaining: number;
  error: string | null;
  period: number;
}

export function useTotpCode(secret: string, nowMs: number): TotpState {
  const settings = parseTotpSettings(secret);
  const period = settings?.period ?? TOTP_PERIOD_SECONDS;
  const windowIndex = Math.floor(nowMs / (period * 1000));
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings === null) {
      setCode(null);
      setError(secret.trim().length > 0 ? "Not a valid authenticator secret" : null);
      return;
    }
    setError(null);
    let cancelled = false;
    computeTotp(settings.secret, Date.now(), settings.period, settings.digits, settings.algorithm)
      .then((value) => {
        if (!cancelled) setCode(value);
      })
      .catch(() => {
        if (!cancelled) {
          setCode(null);
          setError("Not a valid authenticator secret");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings?.secret, settings?.period, settings?.digits, settings?.algorithm, windowIndex]);

  return { code, secondsRemaining: totpSecondsRemaining(period, nowMs), error, period };
}
