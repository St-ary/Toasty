import { useTotpCode } from "../hooks";
import { CopyButton } from "./CopyButton";

interface TotpChipProps {
  secret: string;
  nowMs: number;
}

export function TotpChip({ secret, nowMs }: TotpChipProps): JSX.Element | null {
  const { code, secondsRemaining } = useTotpCode(secret, nowMs);
  if (code === null) return null;
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

export function TotpRow({ secret, nowMs }: TotpRowProps): JSX.Element | null {
  const { code, secondsRemaining } = useTotpCode(secret, nowMs);
  if (code === null) return null;
  return (
    <div className="totp-row">
      <div className="totp-row-main">
        <span className="label">Live code</span>
        <div className="totp-row-code">
          <span className="totp-code num">{code}</span>
          <CopyButton value={code} label="Copy code" compact title="Copy code" />
        </div>
        <div className="countdown" aria-hidden="true">
          <span style={{ width: `${(secondsRemaining / 30) * 100}%` }} />
        </div>
        <span className="muted small num">Refreshes in {secondsRemaining}s</span>
      </div>
    </div>
  );
}
