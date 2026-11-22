import { useState } from "react";
import type { FormEvent } from "react";
import { EyeIcon, EyeOffIcon, LockIcon, MoonIcon, ShieldCheckIcon, SunIcon } from "@toasty/icons";
import { ApiError } from "../lib/api";
import type { ResolvedTheme } from "../lib/theme";
import { useVault } from "../state/vault";

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_credentials") return "Email or master password is incorrect";
    if (error.code === "rate_limited") return "Too many attempts. Wait a moment and try again";
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.startsWith("Unable to decrypt")) return "That master password is incorrect";
    return error.message;
  }
  return "Sign in failed";
}

export interface LoginProps {
  resolvedTheme: ResolvedTheme;
  onToggleTheme: () => void;
}

export function Login({ resolvedTheme, onToggleTheme }: LoginProps): JSX.Element {
  const vault = useVault();
  const [email, setEmail] = useState(() => vault.email ?? "");
  const [masterPassword, setMasterPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (mode === "recovery") {
      void vault
        .unlockWithRecovery(recoveryCode.trim())
        .catch((err: unknown) => setError(loginErrorMessage(err)));
      return;
    }
    const trimmedEmail = email.trim();
    const canUnlockLocally =
      vault.status === "needsUnlock" &&
      vault.hasCachedMeta &&
      vault.email !== null &&
      vault.email === trimmedEmail;
    const attempt = canUnlockLocally
      ? vault.unlockWithPassword(masterPassword)
      : vault.login(trimmedEmail, masterPassword);
    void attempt.catch((err: unknown) => setError(loginErrorMessage(err)));
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
          <span className="label">Vault access</span>
          <h2 className="auth-title">{vault.status === "needsUnlock" ? "Unlock vault" : "Sign in"}</h2>

          {error !== null ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          {mode === "password" ? (
            <>
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
                    autoComplete="current-password"
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
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={vault.busy}>
                <LockIcon size={16} />
                <span>{vault.status === "needsUnlock" ? "Unlock" : "Sign in"}</span>
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setMode("recovery");
                  setError(null);
                }}
              >
                Use a recovery code
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span className="label">Recovery code</span>
                <textarea
                  className="input textarea input-mono"
                  rows={4}
                  value={recoveryCode}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  onChange={(event) => setRecoveryCode(event.target.value)}
                />
              </label>
              <button type="submit" className="btn btn-primary btn-block" disabled={vault.busy}>
                <LockIcon size={16} />
                <span>Unlock</span>
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setMode("password");
                  setError(null);
                }}
              >
                Back to master password
              </button>
            </>
          )}

          <p className="auth-foot">
            <ShieldCheckIcon size={15} />
            <span>Zero-knowledge &mdash; your master password never leaves this device.</span>
          </p>
        </form>
      </div>
    </div>
  );
}
