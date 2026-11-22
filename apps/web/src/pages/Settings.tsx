import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type { BackupFile } from "@toasty/crypto";
import {
  CheckIcon,
  DownloadIcon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
  UploadIcon,
} from "@toasty/icons";
import { backupFileName } from "../lib/time";
import { parsePasswordFile } from "../lib/importers";
import type { ThemePreference } from "../lib/theme";
import { useVault } from "../state/vault";
import { useToast } from "../components/Toasts";
import { StrengthMeter } from "../components/StrengthMeter";
import { VersionControls } from "../components/VersionManager";

function RuleSection({
  index,
  label,
  hint,
  children,
}: {
  index: string;
  label: string;
  hint: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="rule-section">
      <header className="rule-head">
        <span className="rule-index num">{index}</span>
        <div>
          <h2 className="rule-title">{label}</h2>
          <p className="muted">{hint}</p>
        </div>
      </header>
      <div className="rule-body">{children}</div>
    </section>
  );
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof SunIcon }> = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: SettingsIcon },
];

export interface SettingsProps {
  theme: ThemePreference;
  resolvedTheme: "light" | "dark";
  onThemeChange: (preference: ThemePreference) => void;
}

export function Settings({ theme, resolvedTheme, onThemeChange }: SettingsProps): JSX.Element {
  const vault = useVault();
  const { push } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordOk, setPasswordOk] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSourceFile, setImportSourceFile] = useState<File | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitPasswordChange = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordOk(false);
    if (newPassword.length < 8) {
      setPasswordError("New master password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    setBusy(true);
    void vault
      .changeMasterPassword(currentPassword, newPassword)
      .then(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordOk(true);
        push("success", "Master password changed");
      })
      .catch((error: unknown) => {
        setPasswordError(error instanceof Error ? error.message : "Could not change the master password");
      })
      .finally(() => setBusy(false));
  };

  const runExport = (): void => {
    if (exportPassword.length < 8) {
      push("error", "Export password must be at least 8 characters");
      return;
    }
    setBusy(true);
    void vault
      .exportBackup(exportPassword)
      .then((file) => {
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = backupFileName();
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setExportPassword("");
        push("success", `Backup exported as ${backupFileName()}`);
      })
      .catch((error: unknown) => {
        push("error", error instanceof Error ? error.message : "Export failed");
      })
      .finally(() => setBusy(false));
  };

  const runImport = (): void => {
    const file = importFile;
    if (file === null) {
      push("error", "Choose a backup file first");
      return;
    }
    setBusy(true);
    void file
      .text()
      .then((text) => JSON.parse(text) as BackupFile)
      .then((parsed) => vault.importBackup(importPassword, parsed))
      .then((result) => {
        setImportFile(null);
        setImportPassword("");
        push("success", `Imported ${result.imported}, skipped ${result.skipped} duplicates`);
      })
      .catch((error: unknown) => {
        push("error", error instanceof Error ? error.message : "Import failed");
      })
      .finally(() => setBusy(false));
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setImportFile(event.target.files?.[0] ?? null);
  };

  const runPasswordImport = (): void => {
    const file = importSourceFile;
    if (file === null) {
      push("error", "Choose an export file first");
      return;
    }
    setBusy(true);
    void parsePasswordFile(file)
      .then((entries) => vault.importItems(entries))
      .then((result) => {
        setImportSourceFile(null);
        push("success", `Imported ${result.imported} items, skipped ${result.skipped} duplicates`);
      })
      .catch((error: unknown) => {
        push("error", error instanceof Error ? error.message : "Import failed");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="wide-page">
      <header className="page-head">
        <h1 className="display">Settings</h1>
        <p className="label">Account, security, and backups</p>
      </header>

      <RuleSection index="01" label="Account" hint="Your email is the only account metadata the server stores.">
        <div className="settings-row">
          <div>
            <span className="mono account-email">{vault.email ?? "Not signed in"}</span>
          </div>
          <button type="button" className="btn btn-outline" onClick={() => void vault.signOut()}>
            <LogOutIcon size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </RuleSection>

      <RuleSection index="02" label="Appearance" hint="Theme follows your system by default.">
        <div className="radio-row" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <label className={`radio-opt${theme === option.value ? " radio-opt-active" : ""}`} key={option.value}>
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => onThemeChange(option.value)}
              />
              <option.Icon size={16} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="muted small">Currently using the {resolvedTheme} theme.</p>
      </RuleSection>

      <RuleSection
        index="03"
        label="Security"
        hint="Changing your master password re-wraps the vault key. Your items and recovery code stay the same."
      >
        <form className="stack-form" onSubmit={submitPasswordChange}>
          {passwordError !== null ? (
            <p className="form-error" role="alert">
              {passwordError}
            </p>
          ) : null}
          {passwordOk ? <p className="form-success">Master password updated. You stay signed in.</p> : null}
          <div className="field-row">
            <label className="field">
              <span className="label">Current master password</span>
              <input
                className="input input-mono"
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <div className="field">
              <span className="label">New master password</span>
              <input
                className="input input-mono"
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <StrengthMeter password={newPassword} showBits />
            </div>
            <label className="field">
              <span className="label">Confirm new master password</span>
              <input
                className="input input-mono"
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />
            <span>Show passwords</span>
          </label>
          <div className="inline-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <CheckIcon size={16} />
              <span>Change master password</span>
            </button>
            <button type="button" className="btn btn-outline" onClick={vault.lock}>
              <SettingsIcon size={16} />
              <span>Lock vault now</span>
            </button>
          </div>
        </form>
      </RuleSection>

      <RuleSection
        index="04"
        label="Backups"
        hint="Backups are re-encrypted with a separate export password. The file is useless without it."
      >
        <div className="settings-row">
          <div>
            <span className="label">Export</span>
            <p className="muted small">Downloads {backupFileName()} with every item re-encrypted.</p>
            <div className="field inline-field">
              <span className="label">Export password</span>
              <div className="secret-input">
                <input
                  className="input input-mono"
                  type="password"
                  value={exportPassword}
                  autoComplete="new-password"
                  onChange={(event) => setExportPassword(event.target.value)}
                />
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={runExport} disabled={busy}>
            <DownloadIcon size={16} />
            <span>Export encrypted backup</span>
          </button>
        </div>
        <div className="settings-row">
          <div>
            <span className="label">Import</span>
            <p className="muted small">
              Items are re-encrypted under new ids. Items whose name already exists are skipped.
            </p>
            <div className="field-row">
              <label className="field">
                <span className="label">Backup file</span>
                <input
                  className="input"
                  type="file"
                  accept="application/json,.json"
                  onChange={onFileChange}
                />
              </label>
              <div className="field">
                <span className="label">Export password</span>
                <div className="secret-input">
                  <input
                    className="input input-mono"
                    type="password"
                    value={importPassword}
                    autoComplete="new-password"
                    onChange={(event) => setImportPassword(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy}>
            <UploadIcon size={16} />
            <span>Import backup</span>
          </button>
        </div>
      </RuleSection>

      <RuleSection
        index="05"
        label="Import passwords"
        hint="Bring your passwords from Bitwarden, Chrome, Firefox, Edge, 1Password and more. Accepts JSON, CSV, and ZIP exports — items are re-encrypted before they leave this page."
      >
        <div className="settings-row">
          <div>
            <span className="label">Export file</span>
            <p className="muted small">
              Logins, secure notes, cards, and identities are mapped to Toasty items. Duplicate names are
              skipped.
            </p>
            <label className="field">
              <span className="label">File (.zip, .csv, or .json)</span>
              <input
                className="input"
                type="file"
                accept=".zip,.csv,.json,application/zip,text/csv,application/json"
                onChange={(event) => setImportSourceFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <button type="button" className="btn btn-primary" onClick={runPasswordImport} disabled={busy}>
            <UploadIcon size={16} />
            <span>Import passwords</span>
          </button>
        </div>
      </RuleSection>

      <RuleSection
        index="06"
        label="Data"
        hint="The encrypted item cache lives in this browser so the vault keeps working offline."
      >
        <div className="settings-row">
          <div>
            <span className="label">Local cache</span>
            <p className="muted small">
              Clearing it removes downloaded ciphertext from this device. Your account and items stay on
              the server.
            </p>
          </div>
          {confirmClear ? (
            <div className="inline-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                onClick={() => {
                  vault.clearLocalCache();
                  setConfirmClear(false);
                  push("success", "Local cache cleared");
                }}
              >
                <TrashIcon size={16} />
                <span>Confirm clear</span>
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
              <TrashIcon size={16} />
              <span>Clear local cache</span>
            </button>
          )}
        </div>
      </RuleSection>

      <RuleSection
        index="07"
        label="Version & updates"
        hint="Switch this instance to another release whenever you want."
      >
        <VersionControls />
      </RuleSection>
    </div>
  );
}
