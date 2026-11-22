import type { LoginMatch, LoginSummary, Settings } from "./types";

function hostOf(value: string): string | null {
  let candidate = value.trim();
  if (!candidate) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) candidate = `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return host || null;
}

function listMatches(host: string, list: string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function autofillPermitted(settings: Settings, pageUrl: string): boolean {
  const host = hostOf(pageUrl);
  if (host === null) return false;
  if (listMatches(host, settings.autofillBlockedHosts)) return false;
  if (settings.autofillAllowedHosts.length > 0 && !listMatches(host, settings.autofillAllowedHosts)) {
    return false;
  }
  return true;
}

export function normalizeUrl(input: string): string | null {
  const host = hostOf(input);
  return host ? `https://${host}` : null;
}

export function pageHost(url: string): string | null {
  return hostOf(url);
}

function registrableSuffix(host: string): string {
  return host.split(".").filter(Boolean).slice(-2).join(".");
}

export function scoreUrl(pageHostValue: string, itemUrl: string): number {
  const itemHost = hostOf(itemUrl);
  if (!itemHost) return 0;
  if (itemHost === pageHostValue) return 100;
  if (
    pageHostValue.endsWith(`.${itemHost}`) ||
    itemHost.endsWith(`.${pageHostValue}`)
  ) {
    return 60;
  }
  if (
    registrableSuffix(pageHostValue) === registrableSuffix(itemHost) &&
    registrableSuffix(pageHostValue).includes(".")
  ) {
    return 30;
  }
  return 0;
}

export function matchLogins(pageUrl: string, logins: LoginSummary[]): LoginMatch[] {
  const host = hostOf(pageUrl);
  if (!host) return [];
  const matches: LoginMatch[] = [];
  for (const login of logins) {
    let best = 0;
    let bestHost = "";
    for (const url of login.urls) {
      const score = scoreUrl(host, url);
      const urlHost = hostOf(url) ?? "";
      if (score > best) {
        best = score;
        bestHost = urlHost;
      }
    }
    if (best > 0) {
      matches.push({
        id: login.id,
        name: login.name,
        username: login.username,
        score: best,
        host: bestHost || host,
        autofill: login.autofill,
        hasPassword: login.hasPassword,
        hasTotp: login.hasTotp,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return matches;
}
