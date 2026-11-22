import { useEffect, useState } from "react";
import { computeTotp, totpSecondsRemaining } from "@toasty/crypto";
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
}

export function useTotpCode(secret: string, nowMs: number): TotpState {
  const windowIndex = Math.floor(nowMs / (TOTP_PERIOD_SECONDS * 1000));
  const [code, setCode] = useState<string | null>(null);
  const trimmed = secret.trim();

  useEffect(() => {
    if (trimmed.length === 0) {
      setCode(null);
      return;
    }
    let cancelled = false;
    computeTotp(trimmed)
      .then((value) => {
        if (!cancelled) setCode(value);
      })
      .catch(() => {
        if (!cancelled) setCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, windowIndex]);

  return { code, secondsRemaining: totpSecondsRemaining(TOTP_PERIOD_SECONDS, nowMs) };
}
