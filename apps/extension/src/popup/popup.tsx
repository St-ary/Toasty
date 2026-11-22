import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  computeTotp,
  generatePassphrase,
  generatePassword,
  generateUsername,
} from "@toasty/crypto";
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  DicesIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
  PasskeyIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  WandIcon,
} from "@toasty/icons";
import { matchLogins, pageHost, scoreUrl } from "../lib/matching";
import { sendToBackground } from "../lib/messages";
import type {
  Credentials,
  LoginMatch,
  LoginSummary,
  PasskeySummary,
  StatusReport,
  SyncStatus,
} from "../lib/types";

async function copyText(value: string): Promise<void> {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function IconButton({
  label,
  onClick,
  children,
  filled,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  children: ReactNode;
  filled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`icon-btn${filled ? " filled" : ""}${copied ? " ok" : ""}`}
      title={label}
      aria-label={label}
      onClick={() => {
        void Promise.resolve(onClick()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        });
      }}
    >
      {copied ? <CheckIcon size={14} /> : children}
    </button>
  );
}

function SyncPill({ status }: { status: SyncStatus }) {
  const time = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : "never";
  const label =
    status.phase === "syncing"
      ? "Syncing"
      : status.phase === "offline"
        ? "Offline"
        : status.phase === "error"
          ? "Sync error"
          : `Synced ${time}`;
  return (
    <span className="pill" data-phase={status.phase} title={status.error ?? ""}>
      {label}
    </span>
  );
}

function AutofillToggle({
  enabled,
  label,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  onToggle: (next: boolean) => void | Promise<void>;
}) {
  return (
    <IconButton
      label={enabled ? `Autofill is on for ${label}` : `Autofill is off for ${label}`}
      filled={enabled}
      onClick={async () => {
        await onToggle(!enabled);
      }}
    >
      <WandIcon size={14} />
    </IconButton>
  );
}

function ItemRow({
  item,
  showTotp,
  onToggleAutofill,
  onFill,
}: {
  item: LoginSummary;
  showTotp: boolean;
  onToggleAutofill: (itemId: string, next: boolean) => Promise<void>;
  onFill?: () => void;
}) {
  const host = pageHost(item.urls[0] ?? "") ?? item.urls[0] ?? "";
  return (
    <li className="row">
      <div className="row-info">
        <div className="row-name">{item.name}</div>
        <div className="row-meta">
          {item.username ? `${item.username}${host ? ` · ${host}` : ""}` : host}
        </div>
      </div>
      <div className="row-actions">
        <AutofillToggle
          enabled={item.autofill}
          label={item.name}
          onToggle={(next) => onToggleAutofill(item.id, next)}
        />
        <IconButton
          label="Copy username"
          onClick={async () => {
            const credentials = await sendToBackground<Credentials>({
              type: "getCredentials",
              itemId: item.id,
            });
            await copyText(credentials.username);
          }}
        >
          <UserIcon size={14} />
        </IconButton>
        <IconButton
          label="Copy password"
          onClick={async () => {
            const credentials = await sendToBackground<Credentials>({
              type: "getCredentials",
              itemId: item.id,
            });
            await copyText(credentials.password);
          }}
        >
          <KeyIcon size={14} />
        </IconButton>
        {showTotp && item.hasTotp ? (
          <IconButton
            label="Copy authenticator code"
            onClick={async () => {
              const { secret } = await sendToBackground<{ secret: string }>({
                type: "getTotp",
                itemId: item.id,
              });
              await copyText(await computeTotp(secret));
            }}
          >
            <ClockIcon size={14} />
          </IconButton>
        ) : null}
        {item.urls.length > 0 ? (
          <button
            type="button"
            className="icon-btn"
            title="Open and fill"
            aria-label="Open and fill"
            onClick={() => {
              void sendToBackground({ type: "openAndFill", itemId: item.id }).then(() =>
                window.close(),
              );
            }}
          >
            <WandIcon size={14} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function PasskeyRow({
  item,
  onToggleAutofill,
}: {
  item: PasskeySummary;
  onToggleAutofill: (itemId: string, next: boolean) => Promise<void>;
}) {
  return (
    <li className="row">
      <PasskeyIcon size={15} />
      <div className="row-info">
        <div className="row-name">{item.name}</div>
        <div className="row-meta">
          {item.username ? `${item.username}${item.rpId ? ` · ${item.rpId}` : ""}` : item.rpId}
        </div>
      </div>
      <div className="row-actions">
        <AutofillToggle
          enabled={item.autofill}
          label={item.name}
          onToggle={(next) => onToggleAutofill(item.id, next)}
        />
        {item.username ? (
          <IconButton label="Copy username" onClick={async () => copyText(item.username)}>
            <UserIcon size={14} />
          </IconButton>
        ) : null}
      </div>
    </li>
  );
}

function Generators() {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(20);
  const [words, setWords] = useState(5);
  const [style, setStyle] = useState<"words" | "random" | "email">("words");
  const [outputs, setOutputs] = useState({ password: "", username: "", passphrase: "" });

  const regenerate = (): void => {
    setOutputs({
      password: generatePassword({ length }),
      username: generateUsername({ style }),
      passphrase: generatePassphrase(words),
    });
  };

  useEffect(() => {
    if (open && outputs.password === "") regenerate();
  }, [open]);

  return (
    <section className="section">
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
        <span className="label">
          <DicesIcon size={13} /> Generators
        </span>
        <ChevronDownIcon size={14} className={open ? "rot" : ""} />
      </button>
      {open ? (
        <div className="generators">
          <div className="gen">
            <div className="gen-head">
              <span className="label">Password</span>
              <span className="num">{length}</span>
            </div>
            <input
              type="range"
              min={8}
              max={128}
              value={length}
              onChange={(event) => setLength(Number(event.target.value))}
              onMouseUp={regenerate}
              onKeyUp={regenerate}
            />
            <div className="output">
              <code>{outputs.password}</code>
              <IconButton label="New password" onClick={async () => regenerate()}>
                <RefreshIcon size={14} />
              </IconButton>
              <IconButton label="Copy password" onClick={async () => copyText(outputs.password)}>
                <CopyIcon size={14} />
              </IconButton>
            </div>
          </div>
          <div className="gen">
            <div className="gen-head">
              <span className="label">Username</span>
              <select
                value={style}
                onChange={(event) => {
                  setStyle(event.target.value as "words" | "random" | "email");
                  setTimeout(regenerate, 0);
                }}
              >
                <option value="words">words</option>
                <option value="random">random</option>
                <option value="email">email</option>
              </select>
            </div>
            <div className="output">
              <code>{outputs.username}</code>
              <IconButton label="New username" onClick={async () => regenerate()}>
                <RefreshIcon size={14} />
              </IconButton>
              <IconButton label="Copy username" onClick={async () => copyText(outputs.username)}>
                <CopyIcon size={14} />
              </IconButton>
            </div>
          </div>
          <div className="gen">
            <div className="gen-head">
              <span className="label">Passphrase</span>
              <span className="num">{words}</span>
            </div>
            <input
              type="range"
              min={3}
              max={12}
              value={words}
              onChange={(event) => setWords(Number(event.target.value))}
              onMouseUp={regenerate}
              onKeyUp={regenerate}
            />
            <div className="output">
              <code>{outputs.passphrase}</code>
              <IconButton label="New passphrase" onClick={async () => regenerate()}>
                <RefreshIcon size={14} />
              </IconButton>
              <IconButton
                label="Copy passphrase"
                onClick={async () => copyText(outputs.passphrase)}
              >
                <CopyIcon size={14} />
              </IconButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LockedView({ status }: { status: StatusReport }) {
  const [email, setEmail] = useState(status.email);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="locked"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setBusy(true);
        void sendToBackground<StatusReport>({
          type: "unlock",
          email: email.trim(),
          masterPassword: password,
        })
          .then(() => window.location.reload())
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Unlock failed"),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="wordmark">Toasty</div>
      <label className="field">
        <span className="label">Email</span>
        <input
          type="email"
          value={email}
          autoComplete="username"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Master password</span>
        <span className="input-row">
          <input
            type={reveal ? "text" : "password"}
            value={password}
            autoFocus
            autoComplete="current-password"
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
        </span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="btn primary" disabled={busy}>
        <LockIcon size={14} /> Sign in
      </button>
      <p className="foot-note">
        Vault at <code>{status.serverUrl}</code>
        <a href={status.serverUrl} target="_blank" rel="noreferrer" title="Open vault">
          <ExternalLinkIcon size={13} />
        </a>
      </p>
    </form>
  );
}

function UnlockedView() {
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [logins, setLogins] = useState<LoginSummary[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [matched, setMatched] = useState<LoginMatch[]>([]);
  const [query, setQuery] = useState("");
  const [tabHost, setTabHost] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  const refresh = async (): Promise<void> => {
    const report = await sendToBackground<StatusReport>({ type: "getStatus" });
    setStatus(report);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    setTabHost(pageHost(url) ?? "");
    const all = await sendToBackground<LoginSummary[]>({ type: "getLogins" });
    setLogins(all);
    setMatched(matchLogins(url, all));
    setPasskeys(await sendToBackground<PasskeySummary[]>({ type: "getPasskeys" }));
  };

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void refresh();
  }, []);

  const toggleAutofill = async (itemId: string, next: boolean): Promise<void> => {
    await sendToBackground({ type: "setItemAutofill", itemId, autofill: next });
    await refresh();
  };

  const showTotp = status?.settings.showTotpCodes ?? true;

  const filter = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (login: LoginSummary): boolean =>
      !needle ||
      login.name.toLowerCase().includes(needle) ||
      login.username.toLowerCase().includes(needle) ||
      login.urls.some((url) => url.toLowerCase().includes(needle));
  }, [query]);

  const matchedIds = useMemo(() => new Set(matched.map((entry) => entry.id)), [matched]);

  const visiblePasskeys = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matchesTab = (passkey: PasskeySummary): boolean =>
      tabHost.length > 0 &&
      (passkey.rpId === tabHost ||
        tabHost.endsWith(`.${passkey.rpId}`) ||
        passkey.urls.some((url) => scoreUrl(tabHost, url) > 0));
    return passkeys
      .filter(
        (passkey) =>
          !needle ||
          passkey.name.toLowerCase().includes(needle) ||
          passkey.username.toLowerCase().includes(needle) ||
          passkey.rpId.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) => Number(matchesTab(b)) - Number(matchesTab(a)) || a.name.localeCompare(b.name),
      );
  }, [passkeys, query, tabHost]);

  return (
    <div className="unlocked">
      <header className="top">
        <span className="wordmark small">Toasty</span>
        <div className="top-actions">
          {status ? <SyncPill status={status.sync} /> : null}
          <button
            type="button"
            className="icon-btn"
            title="Sync now"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void sendToBackground<SyncStatus>({ type: "syncNow" })
                .then(() => refresh())
                .finally(() => setBusy(false));
            }}
          >
            <RefreshIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Lock vault"
            onClick={() => {
              void sendToBackground<StatusReport>({ type: "lock" }).then(() =>
                window.location.reload(),
              );
            }}
          >
            <LockIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Options"
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      <div className="search-row">
        <SearchIcon size={14} />
        <input
          type="search"
          placeholder="Search vault"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <section className="section">
        <div className="section-head">
          <span className="label">{tabHost ? `Matches for ${tabHost}` : "This tab"}</span>
        </div>
        <ul className="rows">
          {logins
            .filter((login) => matchedIds.has(login.id) && filter(login))
            .map((login) => (
              <ItemRow
                key={login.id}
                item={login}
                showTotp={showTotp}
                onToggleAutofill={toggleAutofill}
              />
            ))}
        </ul>
      </section>

      {visiblePasskeys.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <span className="label">Passkeys</span>
            <span className="num">{visiblePasskeys.length}</span>
          </div>
          <ul className="rows">
            {visiblePasskeys.map((passkey) => (
              <PasskeyRow key={passkey.id} item={passkey} onToggleAutofill={toggleAutofill} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <span className="label">All items</span>
          <span className="num">{logins.filter(filter).length}</span>
        </div>
        <ul className="rows">
          {logins.filter(filter).map((login) => (
            <ItemRow
              key={login.id}
              item={login}
              showTotp={showTotp}
              onToggleAutofill={toggleAutofill}
            />
          ))}
        </ul>
      </section>

      <Generators />
    </div>
  );
}

function App() {
  const [status, setStatus] = useState<StatusReport | null>(null);

  useEffect(() => {
    void sendToBackground<StatusReport>({ type: "getStatus" }).then(setStatus);
  }, []);

  if (!status) return <div className="boot">Loading</div>;
  return status.locked ? <LockedView status={status} /> : <UnlockedView />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
