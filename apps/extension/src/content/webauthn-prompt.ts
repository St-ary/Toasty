export type PasskeyPromptResult = string | "toasty" | "native" | "cancel";

export interface PasskeyPromptConfig {
  title: string;
  subtitle: string;
  entries?: Array<{ id: string; label: string; sublabel: string }>;
  toastyLabel?: string;
  nativeLabel?: string;
}

const ACCENT = "#c68b59";
const ACCENT_CONTRAST = "#ffffff";
const SURFACE = "#ffffff";
const SURFACE_2 = "#faebd7";
const BORDER = "#e8c39e";
const TEXT = "#2b1a0e";
const TEXT_MUTED = "#7a5c43";

const STYLE = `
:host { all: initial; }
.card {
  width: 300px; background: ${SURFACE}; color: ${TEXT};
  border: 1px solid ${BORDER}; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(43, 26, 14, 0.32); padding: 14px;
  font-family: system-ui, sans-serif;
  animation: toast-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.title { font: 600 14px/1.3 Georgia, serif; color: ${TEXT}; margin: 0 0 2px; }
.subtitle { font: 400 12px/1.4 system-ui, sans-serif; color: ${TEXT_MUTED}; margin: 0 0 10px; }
.entry {
  display: block; width: 100%; text-align: left; border: 1px solid ${BORDER};
  background: transparent; border-radius: 9px; padding: 8px 10px; cursor: pointer;
  margin-bottom: 6px;
}
.entry:hover { background: ${SURFACE_2}; }
.entry .label { display: block; font: 600 13px/1.3 system-ui, sans-serif; color: ${TEXT}; }
.entry .sublabel { display: block; font: 400 12px/1.3 system-ui, sans-serif; color: ${TEXT_MUTED}; }
.actions { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.btn {
  border: 1px solid ${BORDER}; border-radius: 9px; padding: 8px 10px; cursor: pointer;
  font: 600 13px/1.2 system-ui, sans-serif; background: transparent; color: ${TEXT};
}
.btn:hover { background: ${SURFACE_2}; }
.btn-primary { background: ${ACCENT}; border-color: ${ACCENT}; color: ${ACCENT_CONTRAST}; }
.btn-primary:hover { filter: brightness(1.06); background: ${ACCENT}; }
.btn-quiet { border-color: transparent; color: ${TEXT_MUTED}; }
.btn-quiet:hover { background: ${SURFACE_2}; }
@media (prefers-color-scheme: dark) {
  .card { background: #2f2117; color: #f7ede2; border-color: #5b3a22; }
  .entry { border-color: #5b3a22; }
  .entry:hover { background: #3a2415; }
  .entry .label { color: #f7ede2; }
  .entry .sublabel, .subtitle, .btn-quiet { color: #c9b39c; }
  .btn { border-color: #5b3a22; color: #f7ede2; }
  .btn:hover { background: #3a2415; }
  .btn-primary { background: ${ACCENT}; border-color: ${ACCENT}; color: #2b1a0e; }
}
`;

export function showPasskeyPrompt(config: PasskeyPromptConfig): Promise<PasskeyPromptResult> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483647";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", config.title);

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = config.title;
    card.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = config.subtitle;
    card.appendChild(subtitle);

    const finish = (result: PasskeyPromptResult): void => {
      host.remove();
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish("cancel");
      }
    };

    for (const entry of config.entries ?? []) {
      const button = document.createElement("button");
      button.className = "entry";
      button.type = "button";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = entry.label;
      const sublabel = document.createElement("span");
      sublabel.className = "sublabel";
      sublabel.textContent = entry.sublabel;
      button.appendChild(label);
      button.appendChild(sublabel);
      button.addEventListener("click", () => finish(entry.id));
      card.appendChild(button);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    if (config.toastyLabel !== undefined) {
      const toasty = document.createElement("button");
      toasty.className = "btn btn-primary";
      toasty.type = "button";
      toasty.textContent = config.toastyLabel;
      toasty.addEventListener("click", () => finish("toasty"));
      actions.appendChild(toasty);
    }
    if (config.nativeLabel !== undefined) {
      const native = document.createElement("button");
      native.className = "btn";
      native.type = "button";
      native.textContent = config.nativeLabel;
      native.addEventListener("click", () => finish("native"));
      actions.appendChild(native);
    }
    const cancel = document.createElement("button");
    cancel.className = "btn btn-quiet";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => finish("cancel"));
    actions.appendChild(cancel);
    card.appendChild(actions);

    shadow.appendChild(card);
    (document.documentElement ?? document.body).appendChild(host);
    document.addEventListener("keydown", onKeyDown, true);
  });
}
