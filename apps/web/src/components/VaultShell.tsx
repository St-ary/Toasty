import type { ReactNode } from "react";
import {
  LockIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
  WandIcon,
} from "@toasty/icons";
import type { SyncStatus } from "../state/vault";
import type { Route } from "../lib/routes";
import { navigate } from "../lib/routes";
import type { ResolvedTheme } from "../lib/theme";
import { UpdateBanner } from "./VersionManager";

const SYNC_LABELS: Record<SyncStatus, string> = {
  synced: "Synced",
  syncing: "Syncing",
  offline: "Offline",
  error: "Sync error",
};

interface NavEntry {
  label: string;
  path: string;
  Icon: typeof LockIcon;
  match: (route: Route) => boolean;
}

const NAV: readonly NavEntry[] = [
  {
    label: "Vault",
    path: "/vault",
    Icon: LockIcon,
    match: (route) => route.name === "vault" || route.name === "item" || route.name === "new",
  },
  { label: "Tools", path: "/tools", Icon: WandIcon, match: (route) => route.name === "tools" },
  {
    label: "Settings",
    path: "/settings",
    Icon: SettingsIcon,
    match: (route) => route.name === "settings",
  },
];

export interface VaultShellProps {
  route: Route;
  email: string | null;
  syncStatus: SyncStatus;
  resolvedTheme: ResolvedTheme;
  onToggleTheme: () => void;
  onLock: () => void;
  children: ReactNode;
}

export function VaultShell({
  route,
  email,
  syncStatus,
  resolvedTheme,
  onToggleTheme,
  onLock,
  children,
}: VaultShellProps): JSX.Element {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="wordmark wordmark-small">Toasty</span>
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`nav-item${entry.match(route) ? " nav-item-active" : ""}`}
              onClick={() => navigate(entry.path)}
            >
              <entry.Icon size={17} />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sync-pill" data-status={syncStatus}>
            <span className="sync-dot" aria-hidden="true" />
            <span className="num">{SYNC_LABELS[syncStatus]}</span>
          </div>
          <div className="sidebar-user">
            <UserIcon size={15} />
            <span className="truncate" title={email ?? ""}>
              {email ?? "Signed out"}
            </span>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="btn btn-outline btn-block" onClick={onLock}>
              <LockIcon size={15} />
              <span>Lock vault</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onToggleTheme}
              aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
            >
              {resolvedTheme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </button>
          </div>
          <p className="sidebar-copy">© 2026 Toasty. All rights reserved.</p>
        </div>
      </aside>
      <main className="main">
        <UpdateBanner />
        {children}
      </main>
    </div>
  );
}
