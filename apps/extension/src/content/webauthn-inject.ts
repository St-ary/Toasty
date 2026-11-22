// Runs in the page's MAIN world (manifest "world": "MAIN") so it can wrap
// navigator.credentials. It never touches chrome.* APIs: everything crosses to
// the isolated content script through window.postMessage with nonce replies.
(() => {
  const CHANNEL = "toasty-webauthn";
  const container: CredentialsContainer | null = navigator.credentials;
  if (!container) return;

  const originalCreate = container.create.bind(container);
  const originalGet = container.get.bind(container);

  function toBytes(value: unknown): Uint8Array {
    if (typeof value === "string") {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const binary = atob(padded);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError("Unsupported buffer type");
  }

  function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  interface BridgeReply {
    ok: boolean;
    result?: unknown;
    error: string | null;
    pong?: unknown;
  }

  function post(kind: string, payload: unknown): Promise<BridgeReply> {
    return new Promise((resolve) => {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const onMessage = (event: MessageEvent): void => {
        if (event.source !== window) return;
        const data = event.data as BridgeReply & { source?: string; nonce?: string };
        if (!data || data.source !== CHANNEL || data.nonce !== nonce) return;
        window.removeEventListener("message", onMessage);
        resolve(data);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ source: CHANNEL, nonce, kind, payload }, "*");
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: "Toasty did not answer in time" });
      }, 300000);
    });
  }

  let bridgeAvailable: boolean | null = null;

  async function toastyPresent(): Promise<boolean> {
    if (bridgeAvailable !== null) return bridgeAvailable;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bridgeAvailable = await new Promise<boolean>((resolve) => {
      const onMessage = (event: MessageEvent): void => {
        if (event.source !== window) return;
        const data = event.data as { source?: string; nonce?: string; pong?: unknown };
        if (!data || data.source !== CHANNEL || data.nonce !== nonce) return;
        window.removeEventListener("message", onMessage);
        resolve(true);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({ source: CHANNEL, nonce, kind: "ping" }, "*");
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, 600);
    });
    return bridgeAvailable;
  }

  function buildAttestationCredential(result: {
    credentialId: string;
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  }): Credential {
    const response = Object.create(AuthenticatorAttestationResponse.prototype);
    Object.defineProperties(response, {
      attestationObject: { value: toBytes(result.attestationObject), enumerable: true, configurable: true },
      clientDataJSON: { value: toBytes(result.clientDataJSON), enumerable: true, configurable: true },
      getTransports: { value: () => result.transports ?? ["internal"], configurable: true },
    });
    const credential = Object.create(PublicKeyCredential.prototype);
    Object.defineProperties(credential, {
      id: { value: result.credentialId, enumerable: true, configurable: true },
      rawId: { value: toBytes(result.credentialId), enumerable: true, configurable: true },
      type: { value: "public-key", enumerable: true, configurable: true },
      authenticatorAttachment: { value: "platform", enumerable: true, configurable: true },
      response: { value: response, enumerable: true, configurable: true },
      getClientExtensionResults: { value: () => ({}), configurable: true },
      toJSON: {
        value: () => ({
          id: result.credentialId,
          rawId: result.credentialId,
          type: "public-key",
          authenticatorAttachment: "platform",
          clientExtensionResults: {},
          response: {
            clientDataJSON: result.clientDataJSON,
            transports: result.transports ?? ["internal"],
          },
        }),
        configurable: true,
      },
    });
    return credential;
  }

  function buildAssertionCredential(result: {
    credentialId: string;
    userHandle: string | null;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }): Credential {
    const response = Object.create(AuthenticatorAssertionResponse.prototype);
    Object.defineProperties(response, {
      clientDataJSON: { value: toBytes(result.clientDataJSON), enumerable: true, configurable: true },
      authenticatorData: { value: toBytes(result.authenticatorData), enumerable: true, configurable: true },
      signature: { value: toBytes(result.signature), enumerable: true, configurable: true },
      userHandle: {
        value: result.userHandle === null ? null : toBytes(result.userHandle),
        enumerable: true,
        configurable: true,
      },
    });
    const credential = Object.create(PublicKeyCredential.prototype);
    Object.defineProperties(credential, {
      id: { value: result.credentialId, enumerable: true, configurable: true },
      rawId: { value: toBytes(result.credentialId), enumerable: true, configurable: true },
      type: { value: "public-key", enumerable: true, configurable: true },
      authenticatorAttachment: { value: "platform", enumerable: true, configurable: true },
      response: { value: response, enumerable: true, configurable: true },
      getClientExtensionResults: { value: () => ({}), configurable: true },
      toJSON: {
        value: () => ({
          id: result.credentialId,
          rawId: result.credentialId,
          type: "public-key",
          authenticatorAttachment: "platform",
          clientExtensionResults: {},
          response: {
            clientDataJSON: result.clientDataJSON,
            authenticatorData: result.authenticatorData,
            signature: result.signature,
            userHandle: result.userHandle,
          },
        }),
        configurable: true,
      },
    });
    return credential;
  }

  container.create = async (
    options?: CredentialCreationOptions | null,
  ): Promise<Credential | null> => {
    const publicKey = options?.publicKey;
    if (publicKey && (await toastyPresent())) {
      const reply = await post("create", {
        rpId: publicKey.rp.id,
        rpName: publicKey.rp.name ?? "",
        userName: publicKey.user.name,
        userDisplayName: publicKey.user.displayName ?? publicKey.user.name,
        challenge: toBase64Url(toBytes(publicKey.challenge)),
        userVerification:
          (publicKey as { userVerification?: string }).userVerification ?? "preferred",
      });
      if (reply.ok && reply.result) return buildAttestationCredential(reply.result as never);
      if (reply.error) throw new DOMException(reply.error, "NotAllowedError");
    }
    return originalCreate(options ?? undefined);
  };

  container.get = async (
    options?: CredentialRequestOptions | null,
  ): Promise<Credential | null> => {
    const publicKey = options?.publicKey;
    if (publicKey && (await toastyPresent())) {
      const reply = await post("get", {
        rpId: publicKey.rpId ?? location.hostname,
        challenge: toBase64Url(toBytes(publicKey.challenge)),
        allowCredentials: (publicKey.allowCredentials ?? []).map((descriptor) =>
          toBase64Url(toBytes(descriptor.id)),
        ),
        userVerification: publicKey.userVerification ?? "preferred",
      });
      if (reply.ok && reply.result) return buildAssertionCredential(reply.result as never);
      if (reply.error) throw new DOMException(reply.error, "NotAllowedError");
    }
    return originalGet(options ?? undefined);
  };
})();
