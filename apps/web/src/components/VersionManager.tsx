import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, RefreshIcon, XIcon } from "@toasty/icons";
import { api, ApiError } from "../lib/api";
import type { VersionApplyResponse, VersionInfo } from "../lib/api";
import { useVersionInfo } from "../hooks";
import { CopyButton } from "./CopyButton";

const DISMISSED_KEY = "toasty.updateDismissed";

function compareVersions(a: string, b: string): number {
  const left = a.split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const right = b.split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (typeof l === "number" && typeof r === "number") {
      if (l !== r) return l < r ? -1 : 1;
      continue;
    }
    const ls = String(l);
    const rs = String(r);
    if (ls !== rs) return ls < rs ? -1 : 1;
  }
  return 0;
}

function actionLabel(current: string, target: string): string {
  const direction = compareVersions(target, current);
  if (direction > 0) return `Update to ${target}`;
  if (direction < 0) return `Downgrade to ${target}`;
  return `Reinstall ${target}`;
}

interface VersionApplyState {
  apply: (version: string) => Promise<void>;
  working: string | null;
  result: VersionApplyResponse | null;
  error: string | null;
  completed: string | null;
}

function useVersionApply(refresh: () => void): VersionApplyState {
  const [working, setWorking] = useState<string | null>(null);
  const [result, setResult] = useState<VersionApplyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  const watchForRestart = useCallback(
    (target: string) => {
      let attempts = 0;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        attempts += 1;
        if (attempts > 60 && timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
          return;
        }
        api
          .getVersion()
          .then((status) => {
            if (status.current === target && timerRef.current !== null) {
              window.clearInterval(timerRef.current);
              timerRef.current = null;
              setCompleted(target);
              refresh();
            }
          })
          .catch(() => undefined);
      }, 3000);
    },
    [refresh],
  );

  const apply = useCallback(
    async (version: string): Promise<void> => {
      setWorking(version);
      setError(null);
      setResult(null);
      setCompleted(null);
      try {
        const response = await api.applyVersion(version);
        setResult(response);
        if (response.mode === "updater") watchForRestart(version);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "The switch could not be started");
      } finally {
        setWorking(null);
      }
    },
    [watchForRestart],
  );

  return { apply, working, result, error, completed };
}

function ApplyStatus({ state }: { state: VersionApplyState }): JSX.Element | null {
  if (state.error !== null) {
    return (
      <p className="form-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.working !== null) {
    return <p className="hint">Starting the switch to {state.working}…</p>;
  }
  if (state.completed !== null) {
    return <p className="form-success">Now running {state.completed}.</p>;
  }
  if (state.result !== null) {
    return (
      <div className="form-success">
        <p>{state.result.message}</p>
        {state.result.command !== undefined ? (
          <div className="secret-block">
            <div className="secret-block-row">
              <code className="secret-value wrap">{state.result.command}</code>
              <CopyButton value={state.result.command} compact title="Copy command" />
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

function versionChoices(versions: VersionInfo[], current: string): VersionInfo[] {
  return versions.filter((entry) => entry.version !== current);
}

export function UpdateBanner(): JSX.Element | null {
  const { info, refresh } = useVersionInfo();
  const state = useVersionApply(refresh);
  const [dismissed, setDismissed] = useState<string | null>(() =>
    window.localStorage.getItem(DISMISSED_KEY),
  );
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (state.completed !== null && info?.latest !== undefined) {
      setDismissed(info.latest ?? state.completed);
    }
  }, [state.completed, info?.latest]);

  if (info === null || !info.updateAvailable || info.latest === null || dismissed === info.latest) {
    return null;
  }
  const others = versionChoices(info.versions, info.current);
  const target = selected.length > 0 ? selected : (others[0]?.version ?? info.latest);

  const dismiss = (): void => {
    window.localStorage.setItem(DISMISSED_KEY, info.latest ?? "");
    setDismissed(info.latest);
  };

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-main">
        <strong className="update-banner-title">Toasty {info.latest} is available</strong>
        <span className="muted small">
          You are on {info.current}. You can update, downgrade to another version, or cancel.
        </span>
      </div>
      {picking ? (
        <div className="update-banner-actions">
          <select
            className="input select"
            value={target}
            aria-label="Version"
            onChange={(event) => setSelected(event.target.value)}
          >
            {others.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
                {entry.releasedAt !== undefined ? ` · ${entry.releasedAt}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline"
            disabled={state.working !== null}
            onClick={() => void state.apply(target)}
          >
            <RefreshIcon size={15} />
            <span>{actionLabel(info.current, target)}</span>
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setPicking(false)}>
            <span>Back</span>
          </button>
        </div>
      ) : (
        <div className="update-banner-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.working !== null}
            onClick={() => void state.apply(info.latest ?? info.current)}
          >
            <CheckIcon size={15} />
            <span>Update to {info.latest}</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setSelected(others[0]?.version ?? info.current);
              setPicking(true);
            }}
          >
            <RefreshIcon size={15} />
            <span>Downgrade</span>
          </button>
          <button type="button" className="btn btn-quiet" onClick={dismiss}>
            <XIcon size={15} />
            <span>Cancel update</span>
          </button>
        </div>
      )}
      <ApplyStatus state={state} />
    </div>
  );
}

export function VersionControls(): JSX.Element {
  const { info, refresh } = useVersionInfo();
  const state = useVersionApply(refresh);
  const [selected, setSelected] = useState("");

  if (info === null) {
    return <p className="muted">Checking for versions…</p>;
  }
  const others = versionChoices(info.versions, info.current);
  const target = selected.length > 0 ? selected : (info.latest ?? others[0]?.version ?? "");

  return (
    <div className="stack-form">
      <div className="settings-row">
        <div>
          <span className="label">Current version</span>
          <span className="account-email">{info.current}</span>
          <p className="hint">
            {info.latest === null
              ? "No release channel is configured on this instance."
              : info.updateAvailable
                ? `Version ${info.latest} is available.`
                : `You are up to date${info.checkedAt !== null ? ` (checked ${new Date(info.checkedAt).toLocaleString()})` : ""}.`}
          </p>
        </div>
      </div>
      {others.length > 0 ? (
        <div className="inline-actions">
          <select
            className="input select"
            style={{ maxWidth: 220 }}
            value={target}
            aria-label="Version"
            onChange={(event) => setSelected(event.target.value)}
          >
            {others.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
                {entry.releasedAt !== undefined ? ` · ${entry.releasedAt}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.working !== null || target.length === 0}
            onClick={() => void state.apply(target)}
          >
            <RefreshIcon size={15} />
            <span>{actionLabel(info.current, target)}</span>
          </button>
          <button type="button" className="btn btn-quiet" onClick={refresh}>
            <RefreshIcon size={15} />
            <span>Check again</span>
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-outline" onClick={refresh}>
          <RefreshIcon size={15} />
          <span>Check again</span>
        </button>
      )}
      <ApplyStatus state={state} />
    </div>
  );
}
