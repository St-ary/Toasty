import { useState } from "react";
import type { FormEvent } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon, MoonIcon, ShieldCheckIcon, SparkIcon, SunIcon } from "@toasty/icons";
import { ApiError } from "../lib/api";
import type { ResolvedTheme } from "../lib/theme";
import { useVault } from "../state/vault";
import { CopyButton } from "../components/CopyButton";
import { StrengthMeter } from "../components/StrengthMeter";

function setupErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_setup_token") return "That setup token is wrong \u2014 check your server logs";
    if (error.code === "registration_closed") return "This instance is already set up. Sign in instead.";
    if (error.code === "email_taken") return "An account with that email already exists on this instance";
    if (error.code === "rate_limited") return "Too many attempts. Wait a moment and try again";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Setup failed";
}

export interface SetupProps {
  resolvedTheme: ResolvedTheme;
  onToggleTheme: () => void;
  onRegistered: (recoveryCode: string) => void;
}

export function Setup({ resolvedTheme, onToggleTheme, onRegistered }: SetupProps): JSX.Element {
  const vault = useVault();
  const [setupToken, setSetupToken] = useState("");
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (setupToken.trim().length === 0) {
      setError("Enter the setup token from your server logs");
      return;
    }
    if (email.trim().length === 0) {
      setError("Enter an email address");
      return;
    }
    if (masterPassword.length < 8) {
      setError("Master password must be at least 8 characters");
      return;
    }
    if (masterPassword !== confirmPassword) {
      setError("Master passwords do not match");
      return;
    }
    void vault
      .register(email.trim(), masterPassword, setupToken.trim())
      .then((recoveryCode) => onRegistered(recoveryCode))
      .catch((err: unknown) => setError(setupErrorMessage(err)));
  };

  return (
    <div className="auth-split">
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <h1 className="wordmark">Toasty</h1>
          <p className="tagline">Your vault. Encrypted in your browser, always.</p>
        </div>
      </aside>
      <div className="auth-panel">
        <button
          type="button"
          className="icon-btn auth-theme"
          onClick={onToggleTheme}
          aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
        >
          {resolvedTheme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
        </button>
        <form className="auth-card" onSubmit={onSubmit}>
          <span className="label">First run</span>
          <h2 className="auth-title">Set up your vault</h2>

          {error !== null ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="field">
            <span className="label">Setup token</span>
            <input
              className="input input-mono"
              type="text"
              value={setupToken}
              autoComplete="off"
              placeholder="From your server logs"
              onChange={(event) => setSetupToken(event.target.value)}
            />
            <span className="hint">From your server logs: docker logs &lt;app&gt;</span>
          </label>
          <label className="field">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              autoComplete="username"
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <div className="field">
            <span className="label">Master password</span>
            <div className="secret-input">
              <input
                className="input input-mono"
                type={showPassword ? "text" : "password"}
                value={masterPassword}
                autoComplete="new-password"
                onChange={(event) => setMasterPassword(event.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={showPassword ? "Hide master password" : "Show master password"}
                title={showPassword ? "Hide" : "Show"}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
              </button>
            </div>
            <StrengthMeter password={masterPassword} showBits />
          </div>
          <label className="field">
            <span className="label">Confirm master password</span>
            <input
              className="input input-mono"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={vault.busy}>
            <SparkIcon size={16} />
            <span>Set up vault</span>
          </button>

          <p className="auth-foot">
            <ShieldCheckIcon size={15} />
            <span>Zero-knowledge &mdash; your master password never leaves this device.</span>
          </p>
        </form>
      </div>
    </div>
  );
}

export interface RecoveryCodeScreenProps {
  recoveryCode: string;
  onContinue: () => void;
}

export function RecoveryCodeScreen({ recoveryCode, onContinue }: RecoveryCodeScreenProps): JSX.Element {
  const [saved, setSaved] = useState(false);
  return (
    <div className="auth-split">
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <h1 className="wordmark">Toasty</h1>
          <p className="tagline">Your vault. Encrypted in your browser, always.</p>
        </div>
      </aside>
      <div className="auth-panel">
        <div className="auth-card">
          <span className="label">Recovery code</span>
          <h2 className="auth-title">Your recovery code</h2>
          <p className="warning-text">This code is the only way back in. Store it offline.</p>
          <div className="recovery-block">
            <span className="recovery-code mono">{recoveryCode}</span>
            <CopyButton value={recoveryCode} label="Copy code" />
          </div>
          <label className="check-row">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            <span>I have saved my recovery code</span>
          </label>
          <button type="button" className="btn btn-primary btn-block" disabled={!saved} onClick={onContinue}>
            <CheckIcon size={16} />
            <span>Continue to vault</span>
          </button>
          <p className="auth-foot">
            <ShieldCheckIcon size={15} />
            <span>Zero-knowledge &mdash; your master password never leaves this device.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
