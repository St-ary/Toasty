import { useTotpCode } from "../hooks";
import { CopyButton } from "./CopyButton";

interface TotpChipProps {
  secret: string;
  nowMs: number;
}

export function TotpChip({ secret, nowMs }: TotpChipProps): JSX.Element {
  const { code, secondsRemaining, error, period } = useTotpCode(secret, nowMs);
  if (error !== null) {
    return (
      <span className="totp-chip totp-chip-error num" title={error}>
        <span className="totp-chip-code">Invalid secret</span>
      </span>
    );
  }
  if (code === null) return <span className="totp-chip num" />;
  return (
    <span className="totp-chip num" title={`Code refreshes in ${secondsRemaining}s`}>
      <span className="totp-chip-code">{code}</span>
      <span className="totp-chip-seconds">{secondsRemaining}s</span>
    </span>
  );
}

interface TotpRowProps {
  secret: string;
  nowMs: number;
}

export function TotpRow({ secret, nowMs }: TotpRowProps): JSX.Element {
  const { code, secondsRemaining, error, period } = useTotpCode(secret, nowMs);
  if (error !== null) {
    return (
      <div className="totp-row">
        <div className="totp-row-main">
          <p className="form-error" role="alert">
            {error}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="totp-row">
      <div className="totp-row-main">
        <span className="label">Live code</span>
        <div className="totp-row-code">
          <span className="totp-code num">{code ?? "······"}</span>
          {code !== null ? <CopyButton value={code} label="Copy code" compact title="Copy code" /> : null}
        </div>
        <div className="countdown" aria-hidden="true">
          <span style={{ width: `${(secondsRemaining / period) * 100}%` }} />
        </div>
        <span className="muted small num">Refreshes in {secondsRemaining}s</span>
      </div>
    </div>
  );
}
