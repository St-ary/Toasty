import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BookIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LogOutIcon,
  RefreshIcon,
  ServerIcon,
  SettingsIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@toasty/icons";
import { DEFAULT_SERVER_URL, getSettings, updateSettings } from "../lib/settings";
import { sendToBackground } from "../lib/messages";
import type { Settings, StatusReport, SyncStatus } from "../lib/types";

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h2 className="label">{label}</h2>
      {children}
    </section>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-title">{title}</div>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function App() {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncLine, setSyncLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [ruleHost, setRuleHost] = useState("");
  const [ruleKind, setRuleKind] = useState<"allow" | "block">("block");

  const refresh = async (): Promise<void> => {
    const status = await sendToBackground<StatusReport>({ type: "getStatus" });
    setReport(status);
    setServerUrl(status.serverUrl);
    setEmail(status.email);
    const time = status.sync.lastSyncAt ? new Date(status.sync.lastSyncAt).toLocaleString() : "never";
    setSyncLine(
      status.sync.phase === "syncing"
        ? "Syncing"
        : status.sync.phase === "offline"
          ? `Offline, last synced ${time}`
          : status.sync.phase === "error"
            ? `Sync error: ${status.sync.error ?? "unknown"}`
            : `Last synced ${time}`,
    );
  };

  const persist = async (patch: Partial<Settings>): Promise<void> => {
    await updateSettings(patch);
    await sendToBackground({ type: "settingsChanged" });
    await refresh();
  };

  useEffect(() => {
    void getSettings().then((settings) => setServerUrl(settings.serverUrl));
    void refresh();
  }, []);

  const addRule = (): void => {
    const host = ruleHost.trim().toLowerCase().replace(/^www\./, "");
    if (host.length === 0 || report === null) return;
    const current = report.settings;
    if (ruleKind === "block") {
      void persist({
        autofillBlockedHosts: [...new Set([...current.autofillBlockedHosts, host])],
        autofillAllowedHosts: current.autofillAllowedHosts.filter((entry) => entry !== host),
      });
    } else {
      void persist({
        autofillAllowedHosts: [...new Set([...current.autofillAllowedHosts, host])],
        autofillBlockedHosts: current.autofillBlockedHosts.filter((entry) => entry !== host),
      });
    }
    setRuleHost("");
  };

  const removeRule = (kind: "allow" | "block", host: string): void => {
    if (report === null) return;
    const current = report.settings;
    if (kind === "block") {
      void persist({ autofillBlockedHosts: current.autofillBlockedHosts.filter((entry) => entry !== host) });
    } else {
      void persist({ autofillAllowedHosts: current.autofillAllowedHosts.filter((entry) => entry !== host) });
    }
  };

  if (!report) return <div className="boot">Loading</div>;

  return (
    <main className="page">
      <header className="top">
        <div>
          <div className="wordmark">Toasty</div>
          <div className="hint">Extension settings</div>
        </div>
        <span className="pill" data-phase={report.sync.phase}>
          {report.locked ? "Locked" : `Signed in as ${report.email}`}
        </span>
      </header>

      <Section label="Account">
        <Row title="Server URL" hint="Any Toasty instance you trust">
          <span className="input-row">
            <ServerIcon size={14} />
            <input
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              onBlur={() =>
                void persist({ serverUrl: serverUrl.trim() || DEFAULT_SERVER_URL })
              }
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setServerUrl(DEFAULT_SERVER_URL);
                void persist({ serverUrl: DEFAULT_SERVER_URL });
              }}
            >
              Reset
            </button>
          </span>
        </Row>
        <Row title="Email">
          <span className="input-row">
            <UserIcon size={14} />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => void persist({ email: email.trim() })}
            />
          </span>
        </Row>
        <Row title="Master password" hint="Never sent to the server">
          <span className="input-row">
            <input
              type={reveal ? "text" : "password"}
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              title={reveal ? "Hide" : "Show"}
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || password.length === 0}
              onClick={() => {
                setBusy(true);
                setError(null);
                void sendToBackground<StatusReport>({
                  type: "unlock",
                  email: email.trim(),
                  masterPassword: password,
                })
                  .then(() => {
                    setPassword("");
                    return refresh();
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Sign in failed"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <LockIcon size={14} /> Sign in
            </button>
          </span>
        </Row>
        {error ? <p className="error">{error}</p> : null}
        <Row title="Session">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void sendToBackground<StatusReport>({ type: "lock" }).then(() => refresh());
            }}
          >
            <LogOutIcon size={14} /> Lock now
          </button>
        </Row>
      </Section>

      <Section label="Autofill">
        <Row title="Fill logins on page load" hint="When a site has exactly one match">
          <input
            type="checkbox"
            className="switch"
            checked={report.settings.autofillOnPageLoad}
            onChange={(event) =>
              void persist({ autofillOnPageLoad: event.target.checked })
            }
          />
        </Row>
        <Row title="Fill logins" hint="Off means fill only by hand from the popup">
          <input
            type="checkbox"
            className="switch"
            checked={report.settings.autofillLogins}
            onChange={(event) => void persist({ autofillLogins: event.target.checked })}
          />
        </Row>
        <Row
          title="Sign in with passkeys"
          hint="Let Toasty answer passkey prompts with vault passkeys"
        >
          <input
            type="checkbox"
            className="switch"
            checked={report.settings.autofillPasskeys}
            onChange={(event) => void persist({ autofillPasskeys: event.target.checked })}
          />
        </Row>
        <Row title="Show authenticator codes" hint="Codes in the popup and fill menus">
          <input
            type="checkbox"
            className="switch"
            checked={report.settings.showTotpCodes}
            onChange={(event) => void persist({ showTotpCodes: event.target.checked })}
          />
        </Row>
        <Row title="Offer to save new logins" hint="Shows a prompt after you sign in">
          <input
            type="checkbox"
            className="switch"
            checked={report.settings.savePrompts}
            onChange={(event) => void persist({ savePrompts: event.target.checked })}
          />
        </Row>
      </Section>

      <Section label="Autofill sites">
        <Row
          title="Site rules"
          hint="Blocked sites never autofill. When any site is allowed, only those sites do."
        >
          <div className="site-rules">
            <span className="input-row">
              <input
                type="text"
                placeholder="example.com"
                value={ruleHost}
                onChange={(event) => setRuleHost(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addRule();
                }}
              />
              <select
                value={ruleKind}
                onChange={(event) => setRuleKind(event.target.value as "allow" | "block")}
              >
                <option value="block">Block</option>
                <option value="allow">Allow only</option>
              </select>
              <button type="button" className="btn" onClick={addRule}>
                Add
              </button>
            </span>
            <div className="rule-chips">
              {report.settings.autofillBlockedHosts.length === 0 &&
              report.settings.autofillAllowedHosts.length === 0 ? (
                <div className="hint">No site rules yet.</div>
              ) : null}
              {report.settings.autofillBlockedHosts.map((host) => (
                <button
                  key={`block-${host}`}
                  type="button"
                  className="rule-chip rule-chip-block"
                  title={`Remove ${host} from the blocked list`}
                  onClick={() => removeRule("block", host)}
                >
                  <span>{host}</span>
                  <XIcon size={12} />
                </button>
              ))}
              {report.settings.autofillAllowedHosts.map((host) => (
                <button
                  key={`allow-${host}`}
                  type="button"
                  className="rule-chip rule-chip-allow"
                  title={`Remove ${host} from the allowed list`}
                  onClick={() => removeRule("allow", host)}
                >
                  <CheckIcon size={12} />
                  <span>{host}</span>
                  <XIcon size={12} />
                </button>
              ))}
            </div>
          </div>
        </Row>
      </Section>

      <Section label="Security">
        <Row title="Auto-lock" hint="Idle time before the vault locks">
          <select
            value={report.settings.autoLockMinutes}
            onChange={(event) =>
              void persist({ autoLockMinutes: Number(event.target.value) })
            }
          >
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </Row>
      </Section>

      <Section label="Data">
        <Row title="Sync" hint={syncLine}>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setSyncLine("Syncing");
              void sendToBackground<SyncStatus>({ type: "syncNow" })
                .then(() => refresh())
                .finally(() => setBusy(false));
            }}
          >
            <RefreshIcon size={14} /> Sync now
          </button>
        </Row>
        <Row title="Local cache" hint="Encrypted items stored on this device">
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              const confirmed = window.confirm(
                "Clear all locally cached vault data on this device?",
              );
              if (!confirmed) return;
              void chrome.storage.local
                .clear()
                .then(() => sendToBackground<StatusReport>({ type: "lock" }))
                .then(() => refresh());
            }}
          >
            <TrashIcon size={14} /> Clear data
          </button>
        </Row>
      </Section>

      <Section label="About">
        <Row title="Version">
          <span className="num">{chrome.runtime.getManifest().version}</span>
        </Row>
        <Row title="Docs">
          <a className="btn" href="https://toasty.stary.lol" target="_blank" rel="noreferrer">
            <BookIcon size={14} /> Guide
          </a>
        </Row>
        <p className="about-note">
          <ShieldIcon size={14} /> Zero-knowledge: encryption happens on this device.
        </p>
      </Section>

      <footer className="foot">
        <SettingsIcon size={12} /> Toasty
        <CheckIcon size={12} /> Local-first settings
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
