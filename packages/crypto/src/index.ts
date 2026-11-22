export const KDF_ITERATIONS = 600_000;
export const KDF_SALT_BYTES = 16;
export const VAULT_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const SECRET_PREFIX = "v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) {
    throw new Error("WebCrypto is unavailable in this environment");
  }
  return webCrypto.subtle;
}

function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pbkdf2Sha512(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  const keyMaterial = await subtle().importKey("raw", textEncoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-512", salt: bufferSource(salt), iterations },
    keyMaterial,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

async function hkdfSha256(
  master: Uint8Array,
  salt: Uint8Array,
  info: string,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", bufferSource(master), "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bufferSource(salt),
      info: bufferSource(textEncoder.encode(info)),
    },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

async function importAesKey(keyBytes: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return subtle().importKey("raw", bufferSource(keyBytes), { name: "AES-GCM" }, false, [usage]);
}

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes, "encrypt");
  const params: AesGcmParams = { name: "AES-GCM", iv: bufferSource(iv), tagLength: 128 };
  if (aad) params.additionalData = bufferSource(aad);
  return new Uint8Array(await subtle().encrypt(params, key, bufferSource(plaintext)));
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes, "decrypt");
  const params: AesGcmParams = { name: "AES-GCM", iv: bufferSource(iv), tagLength: 128 };
  if (aad) params.additionalData = bufferSource(aad);
  return new Uint8Array(await subtle().decrypt(params, key, bufferSource(ciphertext)));
}

function encodeSecret(iv: Uint8Array, ciphertext: Uint8Array): string {
  return `${SECRET_PREFIX}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

function decodeSecret(value: string): { iv: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== SECRET_PREFIX) {
    throw new Error("Unrecognized encrypted key format");
  }
  return { iv: fromBase64Url(parts[1]!), ciphertext: fromBase64Url(parts[2]!) };
}

export async function wrapSecret(wrappingKey: Uint8Array, secret: Uint8Array): Promise<string> {
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = await aesGcmEncrypt(wrappingKey, iv, secret);
  return encodeSecret(iv, ciphertext);
}

export async function unwrapSecret(wrappingKey: Uint8Array, wrapped: string): Promise<Uint8Array> {
  const { iv, ciphertext } = decodeSecret(wrapped);
  try {
    return await aesGcmDecrypt(wrappingKey, iv, ciphertext);
  } catch {
    throw new Error("Unable to decrypt the vault key (wrong master password or recovery code)");
  }
}

export interface DerivedKeys {
  authKey: string;
  wrapKey: Uint8Array;
}

export async function deriveFromMasterPassword(
  masterPassword: string,
  kdfSalt: string,
  iterations: number = KDF_ITERATIONS,
): Promise<DerivedKeys> {
  const salt = fromBase64Url(kdfSalt);
  const master = await pbkdf2Sha512(masterPassword, salt, iterations, 64);
  const authKey = await hkdfSha256(master, salt, "toasty auth key v1", 32);
  const wrapKey = await hkdfSha256(master, salt, "toasty wrap key v1", 32);
  const result: DerivedKeys = { authKey: toBase64Url(authKey), wrapKey };
  wipe(master);
  wipe(authKey);
  return result;
}

export interface AccountSetup {
  email: string;
  kdfSalt: string;
  kdfIterations: number;
  authKey: string;
  wrappedVaultKey: string;
  recoveryWrappedVaultKey: string;
}

export interface NewAccount {
  setup: AccountSetup;
  vaultKey: Uint8Array;
  recoveryCode: string;
}

export async function createAccount(email: string, masterPassword: string): Promise<NewAccount> {
  const kdfSaltBytes = randomBytes(KDF_SALT_BYTES);
  const kdfSalt = toBase64Url(kdfSaltBytes);
  const { authKey, wrapKey } = await deriveFromMasterPassword(masterPassword, kdfSalt);

  const vaultKey = randomBytes(VAULT_KEY_BYTES);
  const wrappedVaultKey = await wrapSecret(wrapKey, vaultKey);

  const recoveryBytes = randomBytes(32);
  const recoveryWrapKey = await hkdfSha256(recoveryBytes, new Uint8Array(0), "toasty recovery wrap v1", 32);
  const recoveryWrappedVaultKey = await wrapSecret(recoveryWrapKey, vaultKey);

  const recoveryCode = formatRecoveryCode(recoveryBytes);
  wipe(recoveryBytes);
  wipe(recoveryWrapKey);
  wipe(wrapKey);

  return {
    setup: {
      email,
      kdfSalt,
      kdfIterations: KDF_ITERATIONS,
      authKey,
      wrappedVaultKey,
      recoveryWrappedVaultKey,
    },
    vaultKey,
    recoveryCode,
  };
}

export interface StoredKeyMaterial {
  kdfSalt: string;
  kdfIterations: number;
  wrappedVaultKey: string;
}

export async function unlock(masterPassword: string, stored: StoredKeyMaterial): Promise<Uint8Array> {
  const { wrapKey } = await deriveFromMasterPassword(masterPassword, stored.kdfSalt, stored.kdfIterations);
  const vaultKey = await unwrapSecret(wrapKey, stored.wrappedVaultKey);
  wipe(wrapKey);
  return vaultKey;
}

export async function unlockWithRecoveryCode(
  recoveryCode: string,
  recoveryWrappedVaultKey: string,
): Promise<Uint8Array> {
  const recoveryBytes = parseRecoveryCode(recoveryCode);
  const recoveryWrapKey = await hkdfSha256(recoveryBytes, new Uint8Array(0), "toasty recovery wrap v1", 32);
  const vaultKey = await unwrapSecret(recoveryWrapKey, recoveryWrappedVaultKey);
  wipe(recoveryBytes);
  wipe(recoveryWrapKey);
  return vaultKey;
}

export interface ChangedMasterPassword {
  authKey: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedVaultKey: string;
}

export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
  stored: StoredKeyMaterial,
): Promise<ChangedMasterPassword> {
  const vaultKey = await unlock(currentPassword, stored);
  const kdfSaltBytes = randomBytes(KDF_SALT_BYTES);
  const kdfSalt = toBase64Url(kdfSaltBytes);
  const { authKey, wrapKey } = await deriveFromMasterPassword(newPassword, kdfSalt);
  const wrappedVaultKey = await wrapSecret(wrapKey, vaultKey);
  wipe(vaultKey);
  wipe(wrapKey);
  return { authKey, kdfSalt, kdfIterations: KDF_ITERATIONS, wrappedVaultKey };
}

export type ItemType = "login" | "note" | "card" | "identity" | "ssh" | "api" | "passkey";

export interface CustomField {
  name: string;
  value: string;
  hidden?: boolean;
}

export interface LoginItem {
  name: string;
  username?: string;
  password?: string;
  urls?: string[];
  totp?: string;
  notes?: string;
  customFields?: CustomField[];
  folderId?: string;
  autofill?: boolean;
}

export interface NoteItem {
  name: string;
  notes: string;
  folderId?: string;
}

export interface CardItem {
  name: string;
  cardholder?: string;
  brand?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  cvv?: string;
  pin?: string;
  notes?: string;
  folderId?: string;
}

export interface IdentityItem {
  name: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  idNumber?: string;
  notes?: string;
  folderId?: string;
}

export interface SshItem {
  name: string;
  keyType?: string;
  publicKey?: string;
  privateKey?: string;
  passphrase?: string;
  host?: string;
  port?: string;
  username?: string;
  fingerprint?: string;
  notes?: string;
  folderId?: string;
}

export interface ApiItem {
  name: string;
  key?: string;
  baseUrl?: string;
  username?: string;
  notes?: string;
  folderId?: string;
}

export interface PasskeyItem {
  name: string;
  rpId?: string;
  rpName?: string;
  username?: string;
  userHandle?: string;
  credentialId?: string;
  privateKey?: string;
  publicKey?: string;
  signCount?: number;
  created?: string;
  notes?: string;
  urls?: string[];
  folderId?: string;
  autofill?: boolean;
}

export interface FolderItem {
  name: string;
}

export type ItemPayload =
  | LoginItem
  | NoteItem
  | CardItem
  | IdentityItem
  | SshItem
  | ApiItem
  | PasskeyItem
  | FolderItem;

export interface ItemRecord {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  updatedAt: string;
  deleted: boolean;
}

export async function encryptItem(
  vaultKey: Uint8Array,
  itemId: string,
  payload: unknown,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(GCM_IV_BYTES);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await aesGcmEncrypt(vaultKey, iv, plaintext, textEncoder.encode(itemId));
  return { ciphertext: toBase64Url(ciphertext), iv: toBase64Url(iv) };
}

export async function decryptItem<T = ItemPayload>(
  vaultKey: Uint8Array,
  itemId: string,
  record: { ciphertext: string; iv: string },
): Promise<T> {
  const plaintext = await aesGcmDecrypt(
    vaultKey,
    fromBase64Url(record.iv),
    fromBase64Url(record.ciphertext),
    textEncoder.encode(itemId),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as T;
}

const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function normalizeRecoveryInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/-/g, "")
    .replace(/\s/g, "")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/O/g, "0");
}

export function formatRecoveryCode(bytes: Uint8Array): string {
  let bits = 0;
  let bitCount = 0;
  let out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      out += RECOVERY_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
    if (bitCount > 0) bits &= (1 << bitCount) - 1;
    else bits = 0;
  }
  if (bitCount > 0) out += RECOVERY_ALPHABET[(bits << (5 - bitCount)) & 31];
  return (out.match(/.{1,4}/g) ?? [out]).join("-");
}

export function parseRecoveryCode(value: string): Uint8Array {
  const normalized = normalizeRecoveryInput(value);
  if (normalized.length < 50 || normalized.length > 56) {
    throw new Error("Recovery code has the wrong length");
  }
  let bits = 0;
  let bitCount = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const index = RECOVERY_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Recovery code contains invalid characters");
    bits = (bits << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      out.push((bits >>> (bitCount - 8)) & 255);
      bitCount -= 8;
      bits &= (1 << bitCount) - 1;
    }
  }
  return new Uint8Array(out);
}

export interface PasswordOptions {
  length?: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
const AMBIGUOUS = "ILO01l|`'\"{}[]()/\\";

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0 || maxExclusive > 256) throw new Error("randomInt range out of bounds");
  const limit = Math.floor(256 / maxExclusive) * maxExclusive;
  let value = 0;
  do {
    value = randomBytes(1)[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

function filterAmbiguous(set: string): string {
  return [...set].filter((ch) => !AMBIGUOUS.includes(ch)).join("");
}

export function generatePassword(options: PasswordOptions = {}): string {
  const length = Math.max(8, Math.min(128, options.length ?? 20));
  const excludeAmbiguous = options.excludeAmbiguous ?? true;
  const classes: string[] = [];
  if (options.upper ?? true) classes.push(UPPER);
  if (options.lower ?? true) classes.push(LOWER);
  if (options.digits ?? true) classes.push(DIGITS);
  if (options.symbols ?? true) classes.push(SYMBOLS);
  if (classes.length === 0) classes.push(LOWER);

  const cleaned = classes.map((set) => (excludeAmbiguous ? filterAmbiguous(set) : set));
  const allChars = cleaned.join("");
  const chars: string[] = [];
  for (const set of cleaned) chars.push(set[randomInt(set.length)]!);
  while (chars.length < length) chars.push(allChars[randomInt(allChars.length)]!);
  chars.length = length;

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

const PASSPHRASE_WORDS = [
  "toast", "cinnamon", "maple", "butter", "syrup", "honey", "sugar", "cream",
  "milk", "cocoa", "vanilla", "caramel", "biscuit", "muffin", "waffle", "pancake",
  "crepe", "scone", "bagel", "crumpet", "brioche", "croissant", "donut", "cookie",
  "brownie", "fudge", "toffee", "nougat", "praline", "ganache", "custard", "pudding",
  "mousse", "sorbet", "gelato", "parfait", "latte", "mocha", "espresso", "macchiato",
  "cappuccino", "americano", "cortado", "affogato", "oat", "barley", "rye", "wheat",
  "grain", "flour", "yeast", "dough", "batter", "crust", "crumb", "glaze",
  "icing", "sprinkle", "drizzle", "swirl", "crunch", "crispy", "golden", "warm",
  "cozy", "snug", "toasty", "roasty", "melty", "flaky", "buttery", "airy",
  "fluffy", "chewy", "gooey", "sweet", "salty", "savory", "zesty", "tangy",
  "mellow", "nutmeg", "clove", "allspice", "ginger", "cardamom", "anise", "saffron",
  "pepper", "mint", "basil", "thyme", "sage", "dapple", "sunny", "goldenrod",
  "russet", "chestnut", "pecan", "walnut", "almond", "hazelnut", "cashew", "peanut",
  "sesame", "poppy", "clover", "meadow", "willow", "amber", "copper", "bronze",
  "sienna", "umber", "ochre", "khaki", "apricot", "peach", "pear", "plum",
  "cherry", "berry", "orchard", "harvest", "autumn", "ember", "hearth", "lantern",
];

export function generatePassphrase(wordCount = 5): string {
  const count = Math.max(3, Math.min(12, wordCount));
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!);
  return words.join("-");
}

export function passwordEntropyBits(password: string): number {
  if (password.length === 0) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;
  return Math.round(password.length * Math.log2(Math.max(poolSize, 2)));
}

export interface BackupFile {
  format: "toasty-backup";
  version: 1;
  kdf: { salt: string; iterations: number; hash: "SHA-512" };
  createdAt: string;
  items: ItemRecord[];
}

export async function createBackup(
  exportPassword: string,
  vaultKey: Uint8Array,
  records: ItemRecord[],
): Promise<BackupFile> {
  const saltBytes = randomBytes(KDF_SALT_BYTES);
  const backupKey = await pbkdf2Sha512(exportPassword, saltBytes, KDF_ITERATIONS, 32);
  const items: ItemRecord[] = [];
  for (const record of records) {
    if (record.deleted) continue;
    const payload = await decryptItem(vaultKey, record.id, record);
    const { ciphertext, iv } = await encryptItem(backupKey, record.id, payload);
    items.push({ ...record, ciphertext, iv });
  }
  wipe(backupKey);
  return {
    format: "toasty-backup",
    version: 1,
    kdf: { salt: toBase64Url(saltBytes), iterations: KDF_ITERATIONS, hash: "SHA-512" },
    createdAt: new Date().toISOString(),
    items,
  };
}

export interface RestoredItem {
  id: string;
  type: string;
  updatedAt: string;
  payload: ItemPayload;
}

export async function openBackup(exportPassword: string, file: BackupFile): Promise<RestoredItem[]> {
  if (file.format !== "toasty-backup" || file.version !== 1) {
    throw new Error("Unrecognized backup file");
  }
  const backupKey = await pbkdf2Sha512(
    exportPassword,
    fromBase64Url(file.kdf.salt),
    file.kdf.iterations,
    32,
  );
  try {
    const restored: RestoredItem[] = [];
    for (const record of file.items) {
      const payload = await decryptItem<ItemPayload>(backupKey, record.id, record);
      restored.push({ id: record.id, type: record.type, updatedAt: record.updatedAt, payload });
    }
    return restored;
  } catch {
    throw new Error("Unable to open the backup (wrong export password)");
  } finally {
    wipe(backupKey);
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let bitCount = 0;
  let out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      out += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
    if (bitCount > 0) bits &= (1 << bitCount) - 1;
    else bits = 0;
  }
  if (bitCount > 0) out += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const normalized = text.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let bitCount = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 character");
    bits = (bits << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      out.push((bits >>> (bitCount - 8)) & 255);
      bitCount -= 8;
      bits &= (1 << bitCount) - 1;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpSettings {
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

const DEFAULT_TOTP: TotpSettings = { secret: "", digits: 6, period: 30, algorithm: "SHA1" };

function otpauthParam(params: URLSearchParams, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of params) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

/**
 * Accepts every form a TOTP secret comes in: an otpauth:// URI (QR export,
 * password-manager export, "copy link" buttons) or a raw base32 key with
 * any mix of spaces, dashes, and casing. Returns null when unusable.
 */
export function parseTotpSettings(value: string): TotpSettings | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const secret = otpauthParam(url.searchParams, "secret");
      if (secret === null) return null;
      const settings = parseTotpSettings(secret);
      if (settings === null) return null;
      const digits = Number.parseInt(otpauthParam(url.searchParams, "digits") ?? "", 10);
      const period = Number.parseInt(otpauthParam(url.searchParams, "period") ?? "", 10);
      const algorithm = (otpauthParam(url.searchParams, "algorithm") ?? "").toUpperCase().replace(/-/g, "");
      return {
        secret: settings.secret,
        digits: digits >= 6 && digits <= 8 ? digits : settings.digits,
        period: period > 0 ? period : settings.period,
        algorithm: algorithm === "SHA256" || algorithm === "SHA512" ? algorithm : "SHA1",
      };
    } catch {
      return null;
    }
  }
  const secret = trimmed.replace(/[\s-]+/g, "").toUpperCase();
  try {
    base32Decode(secret);
  } catch {
    return null;
  }
  return { ...DEFAULT_TOTP, secret };
}

/**
 * Canonical storage form for a user-supplied secret: otpauth URIs are kept
 * intact (they carry digits/period/algorithm), raw keys are normalized to
 * clean base32. Returns null for input that cannot produce codes.
 */
export function normalizeTotpSecret(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^otpauth:\/\//i.test(trimmed)) {
    return parseTotpSettings(trimmed) === null ? null : trimmed;
  }
  const settings = parseTotpSettings(trimmed);
  return settings === null ? null : settings.secret;
}

const HMAC_HASH: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

export async function computeTotp(
  secretOrUri: string,
  timestampMs: number = Date.now(),
  period?: number,
  digits?: number,
  algorithm?: TotpAlgorithm,
): Promise<string> {
  const settings = parseTotpSettings(secretOrUri);
  if (settings === null) throw new Error("Invalid TOTP secret");
  const usePeriod = period ?? settings.period;
  const useDigits = digits ?? settings.digits;
  const useAlgorithm = algorithm ?? settings.algorithm;
  const key = base32Decode(settings.secret);
  const counter = Math.floor(timestampMs / 1000 / usePeriod);
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  const hmacKey = await subtle().importKey(
    "raw",
    bufferSource(key),
    { name: "HMAC", hash: HMAC_HASH[useAlgorithm] },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await subtle().sign("HMAC", hmacKey, bufferSource(counterBytes)));
  const offset = signature[signature.length - 1]! & 0x0f;
  const code =
    (((signature[offset]! & 0x7f) << 24) |
      (signature[offset + 1]! << 16) |
      (signature[offset + 2]! << 8) |
      signature[offset + 3]!) %
    10 ** useDigits;
  return code.toString().padStart(useDigits, "0");
}

export function totpSecondsRemaining(period = 30, nowMs: number = Date.now()): number {
  return period - (Math.floor(nowMs / 1000) % period);
}

export function buildOtpauthUri(params: {
  secret: string;
  account: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const label = params.issuer
    ? `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`
    : encodeURIComponent(params.account);
  const query = new URLSearchParams({
    secret: params.secret,
    algorithm: "SHA1",
    digits: String(params.digits ?? 6),
    period: String(params.period ?? 30),
  });
  if (params.issuer) query.set("issuer", params.issuer);
  return `otpauth://totp/${label}?${query.toString()}`;
}

export interface UsernameOptions {
  style?: "words" | "random" | "email";
  separator?: string;
  length?: number;
  domain?: string;
}

export function generateUsername(options: UsernameOptions = {}): string {
  const style = options.style ?? "words";
  const separator = options.separator ?? ".";
  if (style === "random") {
    const length = Math.max(8, Math.min(64, options.length ?? 16));
    const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)]!;
    return out;
  }
  const first = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!;
  const second = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!;
  const suffix = String(randomInt(100)).padStart(2, "0");
  const local = `${first}${separator}${second}${suffix}`;
  return style === "email" ? `${local}@${options.domain ?? "example.com"}` : local;
}

// --- Passkeys (WebAuthn ES256) ---------------------------------------------

const PASSKEY_FLAG_UP = 0x01;
const PASSKEY_FLAG_UV = 0x04;
const PASSKEY_FLAG_AT = 0x40;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", bufferSource(data)));
}

function cborHead(major: number, length: number): number[] {
  const type = major << 5;
  if (length < 24) return [type | length];
  if (length < 256) return [type | 24, length];
  if (length < 65536) return [type | 25, (length >> 8) & 255, length & 255];
  throw new Error("CBOR value too large");
}

function cborUint(value: number): number[] {
  return value < 0 ? cborHead(1, -value - 1) : cborHead(0, value);
}

function cborBytes(bytes: Uint8Array): number[] {
  return [...cborHead(2, bytes.length), ...bytes];
}

function cborText(value: string): number[] {
  const bytes = textEncoder.encode(value);
  return [...cborHead(3, bytes.length), ...bytes];
}

function cborMap(entries: number[][]): number[] {
  return [...cborHead(5, entries.length), ...entries.flat()];
}

function cosePublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  // COSE EC2 key for ES256: {1: 2, 3: -7, -1: 1, -2: x, -3: y} in canonical order.
  return new Uint8Array(cborMap([
    [...cborUint(1), ...cborUint(2)],
    [...cborUint(3), ...cborUint(-7)],
    [...cborUint(-1), ...cborUint(1)],
    [...cborUint(-2), ...cborBytes(x)],
    [...cborUint(-3), ...cborBytes(y)],
  ]));
}

function cborRead(bytes: Uint8Array, offset: number): { value: unknown; next: number } {
  const initial = bytes[offset];
  if (initial === undefined) throw new Error("Truncated CBOR");
  const major = initial >> 5;
  const info = initial & 31;
  let length: number;
  let cursor = offset + 1;
  if (info < 24) length = info;
  else if (info === 24) {
    length = bytes[cursor]!;
    cursor += 1;
  } else if (info === 25) {
    length = (bytes[cursor]! << 8) | bytes[cursor + 1]!;
    cursor += 2;
  } else throw new Error("Unsupported CBOR length");
  switch (major) {
    case 0:
      return { value: length, next: cursor };
    case 1:
      return { value: -1 - length, next: cursor };
    case 2:
      return { value: bytes.subarray(cursor, cursor + length), next: cursor + length };
    case 3:
      return { value: textDecoder.decode(bytes.subarray(cursor, cursor + length)), next: cursor + length };
    case 5: {
      const map = new Map<number, unknown>();
      for (let i = 0; i < length; i++) {
        const key = cborRead(bytes, cursor);
        const entry = cborRead(bytes, key.next);
        map.set(key.value as number, entry.value);
        cursor = entry.next;
      }
      return { value: map, next: cursor };
    }
    default:
      throw new Error("Unsupported CBOR type");
  }
}

function encodeAttestationObject(authenticatorData: Uint8Array): Uint8Array {
  // Attestation object for the "none" attestation format.
  return new Uint8Array(cborMap([
    [...cborText("fmt"), ...cborText("none")],
    [...cborText("attStmt"), ...cborMap([])],
    [...cborText("authData"), ...cborBytes(authenticatorData)],
  ]));
}

async function importPasskeyPublicKey(publicKey: string): Promise<CryptoKey> {
  const { value } = cborRead(fromBase64Url(publicKey), 0);
  const map = value as Map<number, unknown>;
  const x = map.get(-2);
  const y = map.get(-3);
  if (map.get(1) !== 2 || map.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error("Unsupported passkey public key (expected an ES256 COSE key)");
  }
  return subtle().importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: toBase64Url(x), y: toBase64Url(y), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function p1363ToDer(signature: Uint8Array): Uint8Array {
  const half = signature.length / 2;
  const encodeInt = (raw: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < raw.length - 1 && raw[start] === 0) start++;
    let trimmed = raw.subarray(start);
    if (trimmed[0]! & 0x80) trimmed = concatBytes(new Uint8Array([0]), trimmed);
    return concatBytes(new Uint8Array([0x02, trimmed.length]), trimmed);
  };
  const body = concatBytes(encodeInt(signature.subarray(0, half)), encodeInt(signature.subarray(half)));
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}

function derToP1363(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Not a DER ECDSA signature");
  let cursor = 2;
  const readInt = (): Uint8Array => {
    if (der[cursor] !== 0x02) throw new Error("Malformed DER ECDSA signature");
    const length = der[cursor + 1]!;
    const raw = der.subarray(cursor + 2, cursor + 2 + length);
    cursor += 2 + length;
    let start = 0;
    while (start < raw.length - 1 && raw[start] === 0) start++;
    const trimmed = raw.subarray(start);
    if (trimmed.length > 32) throw new Error("Malformed DER ECDSA signature");
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };
  return concatBytes(readInt(), readInt());
}

function buildClientDataJSON(params: {
  type: "webauthn.create" | "webauthn.get";
  challenge: string;
  origin: string;
}): string {
  const json = JSON.stringify({
    type: params.type,
    challenge: params.challenge,
    origin: params.origin,
    crossOrigin: false,
  });
  return toBase64Url(textEncoder.encode(json));
}

async function buildAuthenticatorData(params: {
  rpId: string;
  flags: number;
  signCount: number;
  attestedCredential?: { credentialId: Uint8Array; publicKeyCose: Uint8Array };
}): Promise<Uint8Array> {
  const rpIdHash = await sha256(textEncoder.encode(params.rpId));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, params.signCount);
  const parts: Uint8Array[] = [rpIdHash, new Uint8Array([params.flags]), counter];
  if (params.attestedCredential) {
    const credId = params.attestedCredential.credentialId;
    const credIdLen = new Uint8Array(2);
    new DataView(credIdLen.buffer).setUint16(0, credId.length);
    parts.push(new Uint8Array(16), credIdLen, credId, params.attestedCredential.publicKeyCose);
  }
  return concatBytes(...parts);
}

export interface PasskeyCredential {
  credentialId: string;
  userHandle: string;
  privateKey: string;
  publicKey: string;
}

export interface PasskeyRegistrationResult extends PasskeyCredential {
  clientDataJSON: string;
  attestationObject: string;
}

export interface PasskeyAssertion {
  credentialId: string;
  userHandle?: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export async function createPasskeyCredential(options: { userHandle?: string } = {}): Promise<PasskeyCredential> {
  const pair = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", pair.privateKey));
  const jwk = await subtle().exportKey("jwk", pair.publicKey);
  if (!jwk.x || !jwk.y) throw new Error("Unexpected public key format");
  return {
    credentialId: toBase64Url(randomBytes(32)),
    userHandle: options.userHandle ?? toBase64Url(randomBytes(32)),
    privateKey: toBase64Url(pkcs8),
    publicKey: toBase64Url(cosePublicKey(fromBase64Url(jwk.x), fromBase64Url(jwk.y))),
  };
}

export async function createPasskeyRegistration(params: {
  rpId: string;
  challenge: string;
  origin: string;
  userHandle?: string;
  userVerification?: boolean;
}): Promise<PasskeyRegistrationResult> {
  const credential = await createPasskeyCredential({ userHandle: params.userHandle });
  const flags =
    PASSKEY_FLAG_UP | PASSKEY_FLAG_AT | (params.userVerification === false ? 0 : PASSKEY_FLAG_UV);
  const authenticatorData = await buildAuthenticatorData({
    rpId: params.rpId,
    flags,
    signCount: 0,
    attestedCredential: {
      credentialId: fromBase64Url(credential.credentialId),
      publicKeyCose: fromBase64Url(credential.publicKey),
    },
  });
  return {
    ...credential,
    clientDataJSON: buildClientDataJSON({
      type: "webauthn.create",
      challenge: params.challenge,
      origin: params.origin,
    }),
    attestationObject: toBase64Url(encodeAttestationObject(authenticatorData)),
  };
}

export async function signPasskeyAssertion(params: {
  privateKey: string;
  credentialId: string;
  userHandle?: string;
  rpId: string;
  challenge: string;
  origin: string;
  signCount: number;
  userVerification?: boolean;
}): Promise<PasskeyAssertion> {
  const flags = PASSKEY_FLAG_UP | (params.userVerification === false ? 0 : PASSKEY_FLAG_UV);
  const authenticatorData = await buildAuthenticatorData({
    rpId: params.rpId,
    flags,
    signCount: params.signCount,
  });
  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.get",
    challenge: params.challenge,
    origin: params.origin,
  });
  const signedData = concatBytes(authenticatorData, await sha256(fromBase64Url(clientDataJSON)));
  const key = await subtle().importKey(
    "pkcs8",
    bufferSource(fromBase64Url(params.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, bufferSource(signedData)),
  );
  return {
    credentialId: params.credentialId,
    userHandle: params.userHandle,
    authenticatorData: toBase64Url(authenticatorData),
    clientDataJSON,
    signature: toBase64Url(p1363ToDer(signature)),
  };
}

export async function verifyPasskeyAssertion(params: {
  publicKey: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}): Promise<boolean> {
  const key = await importPasskeyPublicKey(params.publicKey);
  const signedData = concatBytes(
    fromBase64Url(params.authenticatorData),
    await sha256(fromBase64Url(params.clientDataJSON)),
  );
  return subtle().verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    bufferSource(derToP1363(fromBase64Url(params.signature))),
    bufferSource(signedData),
  );
}
