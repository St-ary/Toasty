import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LoginItem } from "@toasty/crypto";
import {
  buildOtpauthUri,
  generatePassphrase,
  generatePassword,
  generateTotpSecret,
  generateUsername,
  passwordEntropyBits,
} from "@toasty/crypto";
import { DicesIcon, RefreshIcon, SparkIcon } from "@toasty/icons";
import { itemPath, navigate } from "../lib/routes";
import { useNowMs, useTotpCode } from "../hooks";
import { useVault } from "../state/vault";
import { useToast } from "../components/Toasts";
import { CopyButton } from "../components/CopyButton";
import { StrengthMeter } from "../components/StrengthMeter";

interface RuleSectionProps {
  label: string;
  hint: string;
  index: string;
  children: ReactNode;
}

function RuleSection({ label, hint, index, children }: RuleSectionProps): JSX.Element {
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

function OutputRow({
  value,
  onRefresh,
  copyLabel,
}: {
  value: string;
  onRefresh: () => void;
  copyLabel: string;
}): JSX.Element {
  return (
    <div className="output-row">
      <span className="output-value mono">{value}</span>
      <button type="button" className="icon-btn" aria-label="Generate again" title="Generate again" onClick={onRefresh}>
        <RefreshIcon size={16} />
      </button>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

const PASSWORD_DEFAULTS = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
};

function PasswordGenerator(): JSX.Element {
  const [options, setOptions] = useState(PASSWORD_DEFAULTS);
  const [output, setOutput] = useState(() => generatePassword(PASSWORD_DEFAULTS));

  useEffect(() => {
    setOutput(generatePassword(options));
  }, [options]);

  return (
    <>
      <div className="control-row">
        <label className="control">
          <span className="label">Length</span>
          <span className="control-inline">
            <input
              type="range"
              min={8}
              max={128}
              value={options.length}
              onChange={(event) => setOptions({ ...options, length: Number(event.target.value) })}
            />
            <span className="num control-number">{options.length}</span>
          </span>
        </label>
        <div className="control">
          <span className="label">Characters</span>
          <div className="check-grid">
            {(["upper", "lower", "digits", "symbols"] as const).map((key) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
                />
                <span>{key === "upper" ? "Uppercase" : key === "lower" ? "Lowercase" : key === "digits" ? "Digits" : "Symbols"}</span>
              </label>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                checked={options.excludeAmbiguous}
                onChange={(event) => setOptions({ ...options, excludeAmbiguous: event.target.checked })}
              />
              <span>Exclude ambiguous</span>
            </label>
          </div>
        </div>
      </div>
      <OutputRow value={output} onRefresh={() => setOutput(generatePassword(options))} copyLabel="Copy password" />
      <div className="strength-line">
        <StrengthMeter password={output} />
        <span className="muted num">{passwordEntropyBits(output)} bits of entropy</span>
      </div>
    </>
  );
}

type UsernameStyle = "words" | "random" | "email";

function usernameOptions(
  style: UsernameStyle,
  separator: string,
  length: number,
  domain: string,
): { style: UsernameStyle; separator: string; length: number; domain: string } {
  return { style, separator, length, domain };
}

function UsernameGenerator(): JSX.Element {
  const [style, setStyle] = useState<UsernameStyle>("words");
  const [separator, setSeparator] = useState(".");
  const [length, setLength] = useState(16);
  const [domain, setDomain] = useState("example.com");
  const [output, setOutput] = useState(() => generateUsername({ style: "words", separator: "." }));

  const regenerate = (): void => setOutput(generateUsername(usernameOptions(style, separator, length, domain)));

  useEffect(() => {
    setOutput(generateUsername(usernameOptions(style, separator, length, domain)));
  }, [style, separator, length, domain]);

  return (
    <>
      <div className="control-row">
        <label className="control">
          <span className="label">Style</span>
          <select className="select" value={style} onChange={(event) => setStyle(event.target.value as UsernameStyle)}>
            <option value="words">Words</option>
            <option value="random">Random</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label className="control">
          <span className="label">Separator</span>
          <select className="select" value={separator} onChange={(event) => setSeparator(event.target.value)}>
            <option value=".">Dot (.)</option>
            <option value="-">Dash (-)</option>
            <option value="_">Underscore (_)</option>
          </select>
        </label>
        {style === "random" ? (
          <label className="control">
            <span className="label">Length</span>
            <span className="control-inline">
              <input
                type="range"
                min={8}
                max={64}
                value={length}
                onChange={(event) => setLength(Number(event.target.value))}
              />
              <span className="num control-number">{length}</span>
            </span>
          </label>
        ) : null}
        {style === "email" ? (
          <label className="control">
            <span className="label">Domain</span>
            <input className="input" value={domain} onChange={(event) => setDomain(event.target.value)} />
          </label>
        ) : null}
      </div>
      <OutputRow value={output} onRefresh={regenerate} copyLabel="Copy username" />
    </>
  );
}

function PassphraseGenerator(): JSX.Element {
  const [words, setWords] = useState(5);
  const [separator, setSeparator] = useState("-");

  const generate = (): string => generatePassphrase(words).split("-").join(separator);
  const [output, setOutput] = useState(() => generatePassphrase(5));

  useEffect(() => {
    setOutput(generatePassphrase(words).split("-").join(separator));
  }, [words, separator]);

  return (
    <>
      <div className="control-row">
        <label className="control">
          <span className="label">Words</span>
          <span className="control-inline">
            <input
              type="range"
              min={3}
              max={12}
              value={words}
              onChange={(event) => setWords(Number(event.target.value))}
            />
            <span className="num control-number">{words}</span>
          </span>
        </label>
        <label className="control">
          <span className="label">Separator</span>
          <select className="select" value={separator} onChange={(event) => setSeparator(event.target.value)}>
            <option value="-">Dash (-)</option>
            <option value=" ">Space</option>
            <option value=".">Dot (.)</option>
          </select>
        </label>
      </div>
      <OutputRow value={output} onRefresh={() => setOutput(generate())} copyLabel="Copy passphrase" />
    </>
  );
}

function AuthenticatorSetup(): JSX.Element {
  const vault = useVault();
  const { push } = useToast();
  const nowMs = useNowMs();
  const [account, setAccount] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secret, setSecret] = useState("");
  const { code, secondsRemaining } = useTotpCode(secret, nowMs);

  const uri = secret.trim().length > 0
    ? buildOtpauthUri({ secret: secret.trim(), account: account.trim() || "account", issuer: issuer.trim() || undefined })
    : "";

  const saveToVault = (): void => {
    const trimmedSecret = secret.trim();
    if (trimmedSecret.length === 0) {
      push("error", "Generate a secret first");
      return;
    }
    const name =
      issuer.trim().length > 0 && account.trim().length > 0
        ? `${issuer.trim()}:${account.trim()}`
        : account.trim().length > 0
          ? account.trim()
          : issuer.trim().length > 0
            ? issuer.trim()
            : "Authenticator";
    const payload: LoginItem = { name, totp: trimmedSecret };
    if (account.trim().length > 0) payload.username = account.trim();
    void vault
      .addItem("login", payload)
      .then((id) => {
        push("success", "Saved to vault");
        navigate(itemPath(id));
      })
      .catch((error: unknown) => {
        push("error", error instanceof Error ? error.message : "Could not save the item");
      });
  };

  return (
    <>
      <div className="control-row">
        <label className="control">
          <span className="label">Account</span>
          <input
            className="input"
            value={account}
            placeholder="name@example.com"
            onChange={(event) => setAccount(event.target.value)}
          />
        </label>
        <label className="control">
          <span className="label">Issuer</span>
          <input
            className="input"
            value={issuer}
            placeholder="GitHub"
            onChange={(event) => setIssuer(event.target.value)}
          />
        </label>
        <div className="control control-end">
          <button type="button" className="btn btn-primary" onClick={() => setSecret(generateTotpSecret())}>
            <SparkIcon size={16} />
            <span>Generate secret</span>
          </button>
        </div>
      </div>
      {secret.trim().length > 0 ? (
        <div className="authenticator-out">
          <div className="totp-row">
            <div className="totp-row-main">
              <span className="label">Live code</span>
              <div className="totp-row-code">
                <span className="totp-code totp-code-lg num">{code ?? "------"}</span>
                <CopyButton value={code ?? ""} label="Copy code" compact title="Copy code" />
              </div>
              <div className="countdown" aria-hidden="true">
                <span style={{ width: `${(secondsRemaining / 30) * 100}%` }} />
              </div>
              <span className="muted small num">Refreshes in {secondsRemaining}s</span>
            </div>
          </div>
          <div className="secret-block">
            <span className="label">Base32 secret</span>
            <div className="secret-block-row">
              <span className="mono secret-value">{secret}</span>
              <CopyButton value={secret} compact title="Copy secret" />
            </div>
          </div>
          <div className="secret-block">
            <span className="label">otpauth URI</span>
            <div className="secret-block-row">
              <span className="mono secret-value wrap">{uri}</span>
              <CopyButton value={uri} compact title="Copy URI" />
            </div>
          </div>
          <div className="inline-actions">
            <button type="button" className="btn btn-primary" onClick={saveToVault} disabled={vault.busy}>
              <DicesIcon size={16} />
              <span>Save to vault</span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ToolsPage(): JSX.Element {
  return (
    <div className="wide-page">
      <header className="page-head">
        <h1 className="display">Tools</h1>
        <p className="label">Generate credentials locally. Nothing leaves this device.</p>
      </header>
      <RuleSection
        index="01"
        label="Password generator"
        hint="Random passwords from the full character pool."
      >
        <PasswordGenerator />
      </RuleSection>
      <RuleSection
        index="02"
        label="Username generator"
        hint="Memorable word pairs, random strings, or email-style handles."
      >
        <UsernameGenerator />
      </RuleSection>
      <RuleSection
        index="03"
        label="Passphrase generator"
        hint="Word-based passphrases that are easy to type and hard to guess."
      >
        <PassphraseGenerator />
      </RuleSection>
      <RuleSection
        index="04"
        label="Authenticator setup"
        hint="Create a two-factor secret and store it with a login."
      >
        <AuthenticatorSetup />
      </RuleSection>
    </div>
  );
}
