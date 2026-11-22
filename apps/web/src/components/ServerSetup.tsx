import { useState } from "react";
import type { FormEvent } from "react";
import { LockIcon } from "@toasty/icons";
import { getServerUrl, setServerUrl } from "../lib/api";

export function ServerSetup({ onDone }: { onDone: () => void }): JSX.Element {
  const [url, setUrl] = useState(getServerUrl());
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/.test(trimmed)) {
      setError("Enter a full URL, including https://");
      return;
    }
    setServerUrl(trimmed);
    onDone();
  };

  return (
    <div className="auth-panel">
      <form className="auth-card" onSubmit={onSubmit}>
        <span className="label">Server access</span>
        <h2 className="auth-title">Connect to your vault</h2>
        <p className="muted">
          Enter the address of your Toasty server — the same one you use in a
          browser.
        </p>
        <label className="field">
          <span className="label">Server URL</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://vault.example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus
          />
        </label>
        {error !== null ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-block">
          <LockIcon size={15} />
          <span>Continue</span>
        </button>
      </form>
    </div>
  );
}
