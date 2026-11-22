import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@toasty/icons";
import { copyText } from "../lib/clipboard";

interface CopyButtonProps {
  value: string;
  label?: string;
  compact?: boolean;
  title?: string;
}

export function CopyButton({ value, label = "Copy", compact = false, title }: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onClick = useCallback(() => {
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    });
  }, [value]);

  if (compact) {
    return (
      <button
        type="button"
        className="icon-btn"
        onClick={onClick}
        aria-label={copied ? "Copied" : (title ?? label)}
        title={copied ? "Copied" : (title ?? label)}
      >
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
    );
  }

  return (
    <button type="button" className="btn btn-quiet copy-btn" onClick={onClick}>
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
