import { passwordEntropyBits } from "@toasty/crypto";

export type StrengthLevel = "weak" | "fair" | "strong" | "empty";

export function strengthLevel(password: string): StrengthLevel {
  if (password.length === 0) return "empty";
  const bits = passwordEntropyBits(password);
  if (bits < 40) return "weak";
  if (bits < 80) return "fair";
  return "strong";
}

const LABELS: Record<StrengthLevel, string> = {
  empty: "No password",
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
};

interface StrengthMeterProps {
  password: string;
  showBits?: boolean;
}

export function StrengthMeter({ password, showBits = false }: StrengthMeterProps): JSX.Element {
  const level = strengthLevel(password);
  const bits = passwordEntropyBits(password);
  const width = level === "empty" ? 0 : Math.min(100, Math.round((bits / 120) * 100));
  return (
    <div className="strength">
      <div className="strength-bar" aria-hidden="true">
        <span className={`strength-fill strength-${level}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`strength-label strength-${level}`}>{LABELS[level]}</span>
      {showBits ? <span className="strength-bits num">{bits} bits</span> : null}
    </div>
  );
}
