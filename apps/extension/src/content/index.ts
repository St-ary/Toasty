import { computeTotp } from "@toasty/crypto";
import { fillCode, fillCredentials, fillFields } from "./autofill";
import { hideBadges, showBadges, type BadgeEntry, type BadgeField } from "./badge";
import { detectForms, type DetectedForm } from "./forms";
import { installSavePrompt } from "./save-prompt";
import { installWebAuthnBridge } from "./webauthn";
import { autofillPermitted } from "../lib/matching";
import { sendToBackground, type ContentRequest } from "../lib/messages";
import { getSettings } from "../lib/settings";
import type { Credentials, LoginMatch, Settings, StatusReport } from "../lib/types";

installWebAuthnBridge();

function loginForms(): DetectedForm[] {
  return detectForms().filter((detected) => detected.kind === "login");
}

function badgeAnchors(forms: DetectedForm[]): HTMLElement[] {
  const anchors: HTMLElement[] = [];
  for (const form of forms) {
    if (form.usernameField) anchors.push(form.usernameField);
    anchors.push(form.passwordField);
  }
  return anchors;
}

async function selectMatch(itemId: string): Promise<void> {
  const credentials = await sendToBackground<Credentials>({ type: "getCredentials", itemId });
  for (const form of loginForms()) fillCredentials(form, credentials);
  hideBadges();
}

async function selectField(itemId: string, field: BadgeField): Promise<void> {
  const forms = loginForms();
  if (forms.length === 0) return;
  if (field === "code") {
    const { secret } = await sendToBackground<{ secret: string }>({ type: "getTotp", itemId });
    const code = await computeTotp(secret);
    let filled = false;
    for (const form of forms) filled = fillCode(form, code) || filled;
    if (!filled) await navigator.clipboard.writeText(code);
    return;
  }
  const credentials = await sendToBackground<Credentials>({ type: "getCredentials", itemId });
  for (const form of forms) {
    fillFields(
      form,
      field === "username"
        ? { username: credentials.username }
        : { password: credentials.password },
    );
  }
}

function badgeEntries(matches: LoginMatch[]): BadgeEntry[] {
  return matches.map((match) => ({
    id: match.id,
    label: match.name,
    sublabel: match.username || match.host,
    hasUsername: match.username.length > 0,
    hasPassword: match.hasPassword,
    hasTotp: match.hasTotp,
  }));
}

async function attachBadges(): Promise<void> {
  const matches = await sendToBackground<LoginMatch[]>({ type: "getMatching", url: location.href });
  const forms = loginForms();
  if (matches.length === 0 || forms.length === 0) {
    hideBadges();
    return;
  }
  showBadges(badgeAnchors(forms), badgeEntries(matches), (id) => {
    void selectMatch(id);
  }, (id, field) => {
    void selectField(id, field);
  });
}

async function init(): Promise<void> {
  const settings = await getSettings();
  if (settings.savePrompts) installSavePrompt();

  const status = await sendToBackground<StatusReport>({ type: "getStatus" });
  if (status.locked) return;

  const forms = loginForms();
  if (forms.length === 0) return;

  const autofillOn = settings.autofillLogins && autofillPermitted(settings, location.href);
  if (!autofillOn) return;

  const matches = (
    await sendToBackground<LoginMatch[]>({ type: "getMatching", url: location.href })
  ).filter((match) => match.autofill);
  if (matches.length === 0) return;

  const only = matches.length === 1 ? matches[0] : undefined;
  if (settings.autofillOnPageLoad && only) {
    const credentials = await sendToBackground<Credentials>({
      type: "getCredentials",
      itemId: only.id,
    });
    for (const form of forms) fillCredentials(form, credentials);
    return;
  }
  await attachBadges();
}

async function handleMessage(request: ContentRequest): Promise<{ ok: true }> {
  switch (request.type) {
    case "fillItem": {
      for (const form of loginForms()) fillCredentials(form, request.credentials);
      hideBadges();
      break;
    }
    case "showBadge": {
      await attachBadges();
      break;
    }
    case "hideBadge": {
      hideBadges();
      break;
    }
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  handleMessage(message as ContentRequest)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});

void init();
