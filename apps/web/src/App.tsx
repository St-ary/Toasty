import { useCallback, useEffect, useState } from "react";
import { api, getServerUrl } from "./lib/api";
import { isNativeApp, vaultCache } from "./lib/native";
import type { NativeCredential } from "./lib/native";
import { navigate, parseRoute } from "./lib/routes";
import type { Route } from "./lib/routes";
import { getThemePreference, resolveTheme, setThemePreference } from "./lib/theme";
import type { ResolvedTheme, ThemePreference } from "./lib/theme";
import { useVault } from "./state/vault";
import { ServerSetup } from "./components/ServerSetup";
import { VaultShell } from "./components/VaultShell";
import { Login } from "./pages/Login";
import { RecoveryCodeScreen, Setup } from "./pages/Setup";
import { Settings } from "./pages/Settings";
import { ToolsPage } from "./pages/Tools";
import { VaultPage } from "./pages/Vault";

function isVaultView(route: Route): route is Extract<Route, { name: "vault" | "item" | "new" }> {
  return route.name === "vault" || route.name === "item" || route.name === "new";
}

export function App(): JSX.Element {
  const vault = useVault();
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getThemePreference()));
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState<boolean>(() => !isNativeApp() || getServerUrl().length > 0);

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (vault.status !== "signedOut") return;
    let cancelled = false;
    api
      .getStatus()
      .then((status) => {
        if (!cancelled) setNeedsSetup(status.needsSetup);
      })
      .catch(() => {
        if (!cancelled) setNeedsSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vault.status]);

  useEffect(() => {
    setResolvedTheme(resolveTheme(theme));
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setResolvedTheme(resolveTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    if (vault.status === "unlocked" && route.name === "login") navigate("/vault");
  }, [vault.status, route]);

  useEffect(() => {
    const cache = vaultCache();
    if (cache === null) return;
    if (vault.status !== "unlocked") {
      void cache.clear();
      return;
    }
    const entries: NativeCredential[] = [];
    for (const record of vault.items) {
      if (record.deleted || record.type !== "login") continue;
      const payload = vault.decrypted.get(record.id);
      if (payload === undefined) continue;
      const login = payload as { name?: string; username?: string; password?: string; urls?: string[] };
      entries.push({
        id: record.id,
        name: typeof login.name === "string" ? login.name : "",
        username: typeof login.username === "string" ? login.username : "",
        password: typeof login.password === "string" ? login.password : "",
        urls: Array.isArray(login.urls) ? login.urls : [],
      });
    }
    void cache.save({ items: JSON.stringify(entries) });
  }, [vault.status, vault.items, vault.decrypted]);

  const changeTheme = useCallback((preference: ThemePreference) => {
    setTheme(preference);
    setThemePreference(preference);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemePreference = resolveTheme(theme) === "dark" ? "light" : "dark";
    setTheme(next);
    setThemePreference(next);
  }, [theme]);

  if (!serverReady) {
    return <ServerSetup onDone={() => setServerReady(true)} />;
  }

  if (recoveryCode !== null) {
    return (
      <RecoveryCodeScreen
        recoveryCode={recoveryCode}
        onContinue={() => {
          setRecoveryCode(null);
          navigate("/vault");
        }}
      />
    );
  }

  if (vault.status === "unlocked") {
    const shell = (children: JSX.Element): JSX.Element => (
      <VaultShell
        route={route}
        email={vault.email}
        syncStatus={vault.syncStatus}
        resolvedTheme={resolvedTheme}
        onToggleTheme={toggleTheme}
        onLock={vault.lock}
      >
        {children}
      </VaultShell>
    );

    if (isVaultView(route)) return shell(<VaultPage route={route} />);
    if (route.name === "tools") return shell(<ToolsPage />);
    return shell(
      <Settings theme={theme} resolvedTheme={resolvedTheme} onThemeChange={changeTheme} />,
    );
  }

  if (needsSetup === true) {
    return (
      <Setup
        resolvedTheme={resolvedTheme}
        onToggleTheme={toggleTheme}
        onRegistered={(code) => setRecoveryCode(code)}
      />
    );
  }

  return <Login resolvedTheme={resolvedTheme} onToggleTheme={toggleTheme} />;
}
