import { autofillPermitted } from "../lib/matching";
import { sendToBackground } from "../lib/messages";
import { getSettings } from "../lib/settings";
import { showPasskeyPrompt } from "./webauthn-prompt";
import type {
  PasskeyAssertionResult,
  PasskeyMatch,
  PasskeyRegistrationResultWire,
  StatusReport,
} from "../lib/types";

const CHANNEL = "toasty-webauthn";

export interface WebAuthnCreatePayload {
  rpId: string;
  rpName: string;
  userName: string;
  userDisplayName: string;
  challenge: string;
  userVerification: string;
}

export interface WebAuthnGetPayload {
  rpId: string;
  challenge: string;
  allowCredentials: string[];
  userVerification: string;
}

interface BridgeMessage {
  source: string;
  nonce: string;
  kind: "ping" | "create" | "get";
  payload?: WebAuthnCreatePayload | WebAuthnGetPayload;
}

type BridgeOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string | null };

function reply(nonce: string, outcome: BridgeOutcome): void {
  window.postMessage({ source: CHANNEL, nonce, ...outcome }, "*");
}

async function handleGet(payload: WebAuthnGetPayload): Promise<BridgeOutcome> {
  const settings = await getSettings();
  if (!settings.autofillPasskeys || !autofillPermitted(settings, location.href)) {
    return { ok: false, error: null };
  }
  const candidates = await sendToBackground<PasskeyMatch[]>({
    type: "webauthnCandidates",
    rpId: payload.rpId,
    allowCredentials: payload.allowCredentials,
    url: location.href,
  });
  if (candidates.length === 0) {
    return { ok: false, error: null };
  }
  const choice = await showPasskeyPrompt({
    title: `Sign in to ${payload.rpId}`,
    subtitle: "Choose a passkey from your Toasty vault",
    entries: candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.name,
      sublabel: candidate.username || candidate.rpId,
    })),
    nativeLabel: "Use this device",
  });
  if (choice === "cancel") return { ok: false, error: "The request was cancelled" };
  if (choice === "native") return { ok: false, error: null };
  const result = await sendToBackground<PasskeyAssertionResult>({
    type: "webauthnGet",
    itemId: choice,
    rpId: payload.rpId,
    challenge: payload.challenge,
    origin: location.origin,
    userVerification: payload.userVerification,
  });
  return { ok: true, result };
}

async function handleCreate(payload: WebAuthnCreatePayload): Promise<BridgeOutcome> {
  const settings = await getSettings();
  if (!settings.autofillPasskeys || !autofillPermitted(settings, location.href)) {
    return { ok: false, error: null };
  }
  const status = await sendToBackground<StatusReport>({ type: "getStatus" });
  if (status.locked) return { ok: false, error: null };
  const choice = await showPasskeyPrompt({
    title: `Save a passkey for ${payload.rpId}`,
    subtitle: "Toasty can keep this passkey in your vault and sign in with it",
    toastyLabel: "Save to Toasty",
    nativeLabel: "Use this device",
  });
  if (choice === "cancel") return { ok: false, error: "The request was cancelled" };
  if (choice === "native") return { ok: false, error: null };
  const result = await sendToBackground<PasskeyRegistrationResultWire>({
    type: "webauthnCreate",
    rpId: payload.rpId,
    rpName: payload.rpName,
    userName: payload.userName,
    userDisplayName: payload.userDisplayName,
    challenge: payload.challenge,
    origin: location.origin,
    userVerification: payload.userVerification,
  });
  return { ok: true, result };
}

export function installWebAuthnBridge(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const message = event.data as BridgeMessage | null;
    if (!message || message.source !== CHANNEL || typeof message.nonce !== "string") return;
    if (message.kind === "ping") {
      reply(message.nonce, { ok: true, result: "pong" });
      return;
    }
    const run =
      message.kind === "create"
        ? handleCreate(message.payload as WebAuthnCreatePayload)
        : handleGet(message.payload as WebAuthnGetPayload);
    run
      .then((outcome) => reply(message.nonce, outcome))
      .catch((error: unknown) =>
        reply(message.nonce, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  });
}
