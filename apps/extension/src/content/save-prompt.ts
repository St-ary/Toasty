import { getLocalData, updateLocalData } from "../lib/settings";
import { sendToBackground } from "../lib/messages";
import type { LoginMatch, StatusReport } from "../lib/types";
import { describeForm, detectForms, type DetectedForm } from "./forms";

const STYLE = `
:host { all: initial; }
.bar {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100vw - 32px));
  background: #ffffff; color: #2b1a0e; border: 1px solid #e8c39e; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(43, 26, 14, 0.3); padding: 12px 14px;
  font-family: system-ui, sans-serif; z-index: 2147483647;
}
.text { display: flex; flex-direction: column; gap: 2px; }
.title { font: 600 14px/1.3 Georgia, serif; }
.host { font: 400 12px/1.3 system-ui, sans-serif; color: #7a5c43; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }
button {
  border-radius: 8px; border: 1px solid #e8c39e; padding: 7px 12px; cursor: pointer;
  font: 600 12px/1 system-ui, sans-serif; background: #faebd7; color: #2b1a0e;
}
button.primary { background: #c68b59; border-color: #c68b59; color: #ffffff; }
button.primary:hover { background: #8b5e34; border-color: #8b5e34; }
button.never { color: #b3452f; }
@media (prefers-color-scheme: dark) {
  .bar { background: #2f2117; color: #f7ede2; border-color: #5b3a22; }
  .host { color: #c9b39c; }
  button { background: #3a2415; color: #f7ede2; border-color: #5b3a22; }
  button.primary { background: #c68b59; color: #2b1a0e; border-color: #c68b59; }
}
`;

interface PendingPrompt {
  username: string;
  password: string;
  at: number;
}

let lastPrompt: PendingPrompt | null = null;
let activeHost: HTMLElement | null = null;

function siteHost(): string {
  return location.hostname.toLowerCase().replace(/^www\./, "");
}

function resolveForm(form: HTMLFormElement | null): DetectedForm | null {
  if (form) {
    const described = describeForm(form);
    if (described) return described;
  }
  return detectForms().find((candidate) => candidate.kind !== "login") ?? detectForms()[0] ?? null;
}

function removeBar(): void {
  activeHost?.remove();
  activeHost = null;
}

function showBar(
  title: string,
  host: string,
  actions: Array<{ label: string; primary?: boolean; never?: boolean; run: () => void }>,
): void {
  removeBar();
  const root = document.createElement("div");
  const shadow = root.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "bar";

  const text = document.createElement("div");
  text.className = "text";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const hostEl = document.createElement("div");
  hostEl.className = "host";
  hostEl.textContent = host;
  text.appendChild(titleEl);
  text.appendChild(hostEl);

  const buttons = document.createElement("div");
  buttons.className = "actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.primary) button.className = "primary";
    if (action.never) button.className = "never";
    button.addEventListener("click", () => {
      removeBar();
      action.run();
    });
    buttons.appendChild(button);
  }

  bar.appendChild(text);
  bar.appendChild(buttons);
  shadow.appendChild(bar);
  (document.body ?? document.documentElement).appendChild(root);
  activeHost = root;
}

async function offerSave(detected: DetectedForm, host: string): Promise<void> {
  const username = detected.usernameField?.value ?? "";
  const password = detected.passwordField.value;
  showBar("Save password to Toasty?", host, [
    {
      label: "Save",
      primary: true,
      run: () => {
        void sendToBackground({
          type: "saveLogin",
          login: { name: host, username, password, url: location.href },
        });
      },
    },
    {
      label: "Never for this site",
      never: true,
      run: () => {
        void updateLocalData((data) => {
          if (!data.neverSaveHosts.includes(host)) data.neverSaveHosts.push(host);
        });
      },
    },
    { label: "Dismiss", primary: false, run: () => undefined },
  ]);
}

async function offerUpdate(detected: DetectedForm, host: string): Promise<void> {
  const newPassword = detected.newPasswordField?.value ?? "";
  if (!newPassword) return;
  if (detected.confirmField && detected.confirmField.value !== newPassword) return;
  const username = detected.usernameField?.value ?? "";
  const matches = await sendToBackground<LoginMatch[]>({ type: "getMatching", url: location.href });
  const match = username
    ? matches.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase())
    : matches.length === 1
      ? matches[0]
      : undefined;
  if (!match) return;
  showBar("Update password in Toasty?", host, [
    {
      label: "Update",
      primary: true,
      run: () => {
        void sendToBackground({
          type: "updateLogin",
          itemId: match.id,
          password: newPassword,
          username,
        });
      },
    },
    { label: "Dismiss", primary: false, run: () => undefined },
  ]);
}

async function consider(form: HTMLFormElement | null): Promise<void> {
  const detected = resolveForm(form);
  if (!detected || detected.kind === "register") return;
  const password =
    detected.kind === "change" ? detected.newPasswordField?.value ?? "" : detected.passwordField.value;
  if (!password) return;
  const username = detected.usernameField?.value ?? "";
  const now = Date.now();
  if (lastPrompt && lastPrompt.username === username && lastPrompt.password === password && now - lastPrompt.at < 2000) {
    return;
  }
  lastPrompt = { username, password, at: now };

  const host = siteHost();
  const data = await getLocalData();
  if (data.neverSaveHosts.includes(host)) return;
  const status = await sendToBackground<StatusReport>({ type: "getStatus" });
  if (status.locked) return;

  if (detected.kind === "change") {
    await offerUpdate(detected, host);
  } else {
    await offerSave(detected, host);
  }
}

function onSubmit(event: Event): void {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  void consider(form);
}

function onClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const control = target.closest<HTMLElement>("button, input[type='submit'], input[type='image']");
  if (!control) return;
  const form =
    control instanceof HTMLButtonElement || control instanceof HTMLInputElement
      ? control.form
      : null;
  void consider(form ?? control.closest("form"));
}

export function installSavePrompt(): void {
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("click", onClick, true);
}
