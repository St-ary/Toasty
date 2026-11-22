# Toasty Security Model

Toasty is zero-knowledge: the server (whether self-hosted or at toasty.stary.lol /
vault.stary.lol) only ever stores ciphertext and key-wrapping material. A compromised
server reveals nothing about passwords without the user's master password or recovery code.

## Key hierarchy

```
master password (user's head, never leaves the device)
   │
   ├─ PBKDF2-HMAC-SHA-512, 600,000 iterations, 16-byte random per-user salt
   │        (salt + iteration count stored server-side, not secret)
   ▼
64-byte master key
   │
   ├─ HKDF-SHA-256(info="toasty auth key v1")  → authKey (32B)  → sent to server on
   │                                                  register/login as proof of knowledge;
   │                                                  server stores scrypt(authKey) only
   ├─ HKDF-SHA-256(info="toasty wrap key v1")  → wrapKey (32B)  → AES-256-GCM unwraps
   │                                                  the vault key
   ▼
vault key (32B random, generated on the device at signup)
   │
   └─ AES-256-GCM encrypts every vault item (per-item random 96-bit IV, AAD = item id)
```

Recovery code (shown once at signup): 32 random bytes encoded as Crockford base32
(52 chars, grouped). `HKDF-SHA-256(recoveryBytes, info="toasty recovery wrap v1")`
produces a second wrapping key that also wraps the vault key, so the recovery code can
unlock the vault but cannot authenticate to the server. Changing the master password
re-wraps the vault key but leaves the recovery wrap untouched.

## Guarantees

- Master password, vault key, and plaintext items never leave the client.
- Server-side `authKey` verification uses scrypt (N=16384, r=8, p=1) with per-user
  salt and constant-time comparison; the auth key is 32 bytes of high-entropy HKDF
  output, so offline brute force of the server database is infeasible.
- Item ciphertext is AES-256-GCM authenticated (tamper-evident) and bound to its item
  id via AAD, so ciphertext cannot be swapped between rows.
- Session tokens are 32 random bytes; the server stores only their SHA-256 hash.
- All network traffic must be TLS (Caddy terminates TLS in the recommended setup).

## Non-guarantees / threat model notes

- A malicious server can deny service, roll back items to older versions, or correlate
  metadata (item count, sizes, timestamps, account email).
- The web app runs its JS from the server origin: a malicious server operator could
  serve modified client code that exfiltrates the master password at login time.
  Security-critical users should verify the self-hosted build matches this source.
- XSS in the web vault would be catastrophic; all item data is rendered as text
  (React default escaping), never `dangerouslySetInnerHTML`.
- No plaintext secrets in logs; the server logs method/path/status only.

## Client caching

The web vault caches ciphertext blobs locally (localStorage) so the vault works
offline. Cached data is exactly what the server holds (still encrypted);
decrypted material lives only in memory while unlocked.

## Cryptographic implementation notes

All client crypto uses WebCrypto (native, constant-time implementations):

- PBKDF2-HMAC-SHA-512, 600 000 iterations (OWASP-aligned), 16-byte salt.
- HKDF-SHA-256 for domain separation between auth key / wrap key / recovery wrap key.
- AES-256-GCM, 128-bit tags, random 96-bit IVs, AAD = item id (items) or none (key wrap).
- Wrapped key string format: `v1.<base64url(iv)>.<base64url(ct)>`.
- Password generator uses rejection sampling (no modulo bias) over the configured
  character classes.

Shared implementation: `packages/crypto` (`@toasty/crypto`) — used verbatim by the web
vault.
