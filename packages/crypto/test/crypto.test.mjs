import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccount,
  unlock,
  unlockWithRecoveryCode,
  changeMasterPassword,
  encryptItem,
  decryptItem,
  createBackup,
  openBackup,
  generatePassword,
  generatePassphrase,
  generateUsername,
  generateTotpSecret,
  computeTotp,
  totpSecondsRemaining,
  buildOtpauthUri,
  base32Encode,
  base32Decode,
  formatRecoveryCode,
  parseRecoveryCode,
  toBase64Url,
  fromBase64Url,
  randomBytes,
  createPasskeyCredential,
  createPasskeyRegistration,
  signPasskeyAssertion,
  verifyPasskeyAssertion,
  KDF_ITERATIONS,
} from "../dist/index.js";

test("base64url round trip", () => {
  for (const length of [0, 1, 2, 3, 16, 31, 32]) {
    const bytes = randomBytes(length);
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  }
});

test("recovery code round trip", () => {
  const bytes = randomBytes(32);
  const code = formatRecoveryCode(bytes);
  assert.deepEqual(parseRecoveryCode(code), bytes);
  assert.deepEqual(parseRecoveryCode(code.toLowerCase().replace(/-/g, " ")), bytes);
});

test("account creation, unlock, and item round trip", async () => {
  const account = await createAccount("taster@stary.lol", "correct horse battery staple");
  assert.equal(account.setup.kdfIterations, KDF_ITERATIONS);
  assert.ok(account.recoveryCode.length > 0);

  const vaultKey = await unlock("correct horse battery staple", account.setup);
  assert.deepEqual(vaultKey, account.vaultKey);

  const payload = { name: "Cinnamon Bank", username: "toast", password: "secret", urls: ["https://bank.example"] };
  const record = await encryptItem(account.vaultKey, "item-1", payload);
  const decrypted = await decryptItem(account.vaultKey, "item-1", record);
  assert.deepEqual(decrypted, payload);
});

test("wrong master password is rejected", async () => {
  const account = await createAccount("taster@stary.lol", "right-password");
  await assert.rejects(() => unlock("wrong-password", account.setup), /wrong master password/i);
});

test("item ciphertext is bound to its id", async () => {
  const account = await createAccount("taster@stary.lol", "pw");
  const record = await encryptItem(account.vaultKey, "item-1", { name: "a" });
  await assert.rejects(() => decryptItem(account.vaultKey, "item-2", record));
});

test("tampered ciphertext is rejected", async () => {
  const account = await createAccount("taster@stary.lol", "pw");
  const record = await encryptItem(account.vaultKey, "item-1", { name: "a" });
  const flipped = record.ciphertext.slice(0, -2) + (record.ciphertext.endsWith("A") ? "B" : "A");
  await assert.rejects(() => decryptItem(account.vaultKey, "item-1", { ...record, ciphertext: flipped }));
});

test("recovery code unlocks the vault", async () => {
  const account = await createAccount("taster@stary.lol", "pw");
  const vaultKey = await unlockWithRecoveryCode(
    account.recoveryCode,
    account.setup.recoveryWrappedVaultKey,
  );
  assert.deepEqual(vaultKey, account.vaultKey);
});

test("changing master password keeps the vault key and recovery code", async () => {
  const account = await createAccount("taster@stary.lol", "old-pw");
  const changed = await changeMasterPassword("old-pw", "new-pw", account.setup);

  await assert.rejects(() => unlock("old-pw", changed), /wrong master password/i);
  const vaultKey = await unlock("new-pw", changed);
  assert.deepEqual(vaultKey, account.vaultKey);

  const recovered = await unlockWithRecoveryCode(
    account.recoveryCode,
    account.setup.recoveryWrappedVaultKey,
  );
  assert.deepEqual(recovered, account.vaultKey);
});

test("encrypted backup round trip", async () => {
  const account = await createAccount("taster@stary.lol", "pw");
  const record = {
    ...(await encryptItem(account.vaultKey, "item-1", { name: "Maple", password: "x" })),
    id: "item-1",
    type: "login",
    updatedAt: new Date().toISOString(),
    deleted: false,
  };

  const backup = await createBackup("export-pw", account.vaultKey, [record]);
  const restored = await openBackup("export-pw", backup);
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].payload, { name: "Maple", password: "x" });

  await assert.rejects(() => openBackup("nope", backup), /wrong export password/i);
});

test("password generator honours options", () => {
  const password = generatePassword({ length: 24, symbols: false });
  assert.equal(password.length, 24);
  assert.ok(!/[^a-zA-Z0-9]/.test(password));

  const withSymbols = generatePassword({ length: 32 });
  assert.equal(withSymbols.length, 32);

  const phrase = generatePassphrase(6);
  assert.equal(phrase.split("-").length, 6);
});

test("base32 round trip", () => {
  for (const length of [1, 5, 10, 20, 32]) {
    const bytes = randomBytes(length);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
});

test("TOTP matches RFC 6238 SHA-1 test vectors", async () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [unixSeconds, expected] of vectors) {
    const code = await computeTotp(secret, unixSeconds * 1000, 30, 8);
    assert.equal(code, expected, `T=${unixSeconds}`);
  }
});

test("TOTP secret, countdown, and otpauth uri", async () => {
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  const code = await computeTotp(secret);
  assert.match(code, /^\d{6}$/);
  const remaining = totpSecondsRemaining();
  assert.ok(remaining >= 1 && remaining <= 30);

  const uri = buildOtpauthUri({ secret, account: "toast@stary.lol", issuer: "Toasty" });
  assert.ok(uri.startsWith("otpauth://totp/Toasty:toast%40stary.lol?"));
  assert.ok(uri.includes(`secret=${secret}`));
  assert.ok(uri.includes("issuer=Toasty"));
});

test("username generator styles", () => {
  const words = generateUsername();
  assert.match(words, /^[a-z]+[.][a-z]+\d{2}$/);
  const dashed = generateUsername({ separator: "-" });
  assert.match(dashed, /^[a-z]+-[a-z]+\d{2}$/);
  const random = generateUsername({ style: "random", length: 20 });
  assert.match(random, /^[a-z2-9]{20}$/);
  const email = generateUsername({ style: "email", domain: "stary.lol" });
  assert.match(email, /^[a-z]+[.][a-z]+\d{2}@stary\.lol$/);
});

function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

test("passkey credential creation and assertion signing", async () => {
  const credential = await createPasskeyCredential();
  assert.equal(fromBase64Url(credential.credentialId).length, 32);
  assert.equal(fromBase64Url(credential.userHandle).length, 32);
  assert.ok(credential.privateKey.length > 80);
  assert.ok(credential.publicKey.length > 80);

  const challenge = toBase64Url(new Uint8Array([1, 2, 3, 4]));
  const assertion = await signPasskeyAssertion({
    privateKey: credential.privateKey,
    credentialId: credential.credentialId,
    userHandle: credential.userHandle,
    rpId: "example.com",
    challenge,
    origin: "https://example.com",
    signCount: 7,
    userVerification: true,
  });
  assert.equal(assertion.credentialId, credential.credentialId);
  assert.equal(assertion.userHandle, credential.userHandle);

  const verified = await verifyPasskeyAssertion({
    publicKey: credential.publicKey,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    signature: assertion.signature,
  });
  assert.equal(verified, true);

  const authData = fromBase64Url(assertion.authenticatorData);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("example.com")));
  assert.deepEqual(authData.subarray(0, 32), rpIdHash);
  assert.equal(authData[32], 0x05);
  assert.deepEqual(authData.subarray(33, 37), new Uint8Array([0, 0, 0, 7]));

  const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(assertion.clientDataJSON)));
  assert.deepEqual(clientData, {
    type: "webauthn.get",
    challenge,
    origin: "https://example.com",
    crossOrigin: false,
  });

  const signature = fromBase64Url(assertion.signature);
  signature[10] ^= 0xff;
  const tampered = await verifyPasskeyAssertion({
    publicKey: credential.publicKey,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    signature: toBase64Url(signature),
  });
  assert.equal(tampered, false);

  const wrongChallenge = await signPasskeyAssertion({
    privateKey: credential.privateKey,
    credentialId: credential.credentialId,
    rpId: "example.com",
    challenge: toBase64Url(new Uint8Array([9, 9])),
    origin: "https://example.com",
    signCount: 8,
    userVerification: true,
  });
  assert.equal(
    await verifyPasskeyAssertion({
      publicKey: credential.publicKey,
      authenticatorData: wrongChallenge.authenticatorData,
      clientDataJSON: assertion.clientDataJSON,
      signature: wrongChallenge.signature,
    }),
    false,
  );
});

test("passkey registration attestation object shape", async () => {
  const registration = await createPasskeyRegistration({
    rpId: "vault.example",
    challenge: toBase64Url(new Uint8Array([9, 9, 9])),
    origin: "https://vault.example",
    userVerification: true,
  });

  const attestation = fromBase64Url(registration.attestationObject);
  assert.equal(attestation[0], 0xa3);
  const ascii = new TextDecoder().decode(attestation);
  for (const marker of ["fmt", "none", "attStmt", "authData"]) {
    assert.ok(ascii.includes(marker), `attestation object contains ${marker}`);
  }

  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("vault.example")));
  const idx = indexOfBytes(attestation, rpIdHash);
  assert.ok(idx > 0, "authenticatorData starts with the rpId hash");
  assert.equal(attestation[idx + 32], 0x45);
  assert.deepEqual(attestation.subarray(idx + 33, idx + 37), new Uint8Array(4));

  const clientData = JSON.parse(new TextDecoder().decode(fromBase64Url(registration.clientDataJSON)));
  assert.equal(clientData.type, "webauthn.create");
  assert.equal(clientData.origin, "https://vault.example");

  const assertion = await signPasskeyAssertion({
    privateKey: registration.privateKey,
    credentialId: registration.credentialId,
    userHandle: registration.userHandle,
    rpId: "vault.example",
    challenge: toBase64Url(new Uint8Array([1])),
    origin: "https://vault.example",
    signCount: 1,
    userVerification: true,
  });
  assert.equal(
    await verifyPasskeyAssertion({
      publicKey: registration.publicKey,
      authenticatorData: assertion.authenticatorData,
      clientDataJSON: assertion.clientDataJSON,
      signature: assertion.signature,
    }),
    true,
  );
});

test("passkey item round trip through the vault", async () => {
  const account = await createAccount("taster@stary.lol", "pw");
  const credential = await createPasskeyCredential();
  const payload = {
    name: "Passkey for vault.example",
    rpId: "vault.example",
    username: "toast",
    credentialId: credential.credentialId,
    userHandle: credential.userHandle,
    privateKey: credential.privateKey,
    publicKey: credential.publicKey,
    signCount: 3,
    created: "2026-11-21T00:00:00.000Z",
  };
  const record = await encryptItem(account.vaultKey, "item-1", payload);
  const decrypted = await decryptItem(account.vaultKey, "item-1", record);
  assert.deepEqual(decrypted, payload);
});

test("folder entries and folderId round trip", async () => {
  const account = await createAccount("taster@stary.lol", "pw");

  const folder = { name: "Kitchen logins" };
  const folderRecord = await encryptItem(account.vaultKey, "folder-1", folder);
  assert.deepEqual(await decryptItem(account.vaultKey, "folder-1", folderRecord), folder);

  const login = {
    name: "Toaster",
    username: "crumb",
    folderId: "folder-1",
    autofill: false,
    urls: ["https://toast.example"],
  };
  const loginRecord = await encryptItem(account.vaultKey, "item-1", login);
  assert.deepEqual(await decryptItem(account.vaultKey, "item-1", loginRecord), login);

  const passkey = {
    name: "Passkey for toast.example",
    rpId: "toast.example",
    folderId: "folder-1",
    autofill: true,
    credentialId: "abc",
  };
  const passkeyRecord = await encryptItem(account.vaultKey, "item-2", passkey);
  assert.deepEqual(await decryptItem(account.vaultKey, "item-2", passkeyRecord), passkey);
});
