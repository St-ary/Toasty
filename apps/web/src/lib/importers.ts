import type { CardItem, IdentityItem, ItemType, LoginItem, NoteItem } from "@toasty/crypto";
import { normalizeTotpSecret } from "@toasty/crypto";

export interface ImportedItem {
  type: ItemType;
  payload: LoginItem | NoteItem | CardItem | IdentityItem;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function totpSecret(value: string): string | undefined {
  if (typeof value !== "string") return undefined;
  return normalizeTotpSecret(value) ?? undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface BitwardenItem {
  type?: number | null;
  name?: string | null;
  notes?: string | null;
  fields?: Array<{ name?: string | null; value?: string | null; type?: number | null }> | null;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: Array<{ uri?: string | null } | null> | null;
  } | null;
  card?: {
    cardholderName?: string | null;
    brand?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  } | null;
  identity?: Record<string, unknown> | null;
}

function mapBitwardenItem(item: BitwardenItem): ImportedItem | null {
  const name = clean(item.name).length > 0 ? clean(item.name) : "Imported item";
  const notes = clean(item.notes);
  const customFields = (item.fields ?? [])
    .map((field) => ({ name: clean(field.name), value: clean(field.value), hidden: field.type === 1 }))
    .filter((field) => field.name.length > 0 || field.value.length > 0);

  switch (item.type) {
    case 1: {
      const login = item.login ?? {};
      const payload: LoginItem = { name };
      const username = clean(login.username);
      const password = clean(login.password);
      const totp = totpSecret(login.totp ?? "");
      const urls = (login.uris ?? []).map((entry) => clean(entry?.uri)).filter((uri) => uri.length > 0);
      if (username.length > 0) payload.username = username;
      if (password.length > 0) payload.password = password;
      if (totp !== undefined) payload.totp = totp;
      if (urls.length > 0) payload.urls = urls;
      if (notes.length > 0) payload.notes = notes;
      if (customFields.length > 0) payload.customFields = customFields;
      return { type: "login", payload };
    }
    case 2:
      return { type: "note", payload: { name, notes } };
    case 3: {
      const card = item.card ?? {};
      const payload: CardItem = { name };
      const cardholder = clean(card.cardholderName);
      const brand = clean(card.brand);
      const number = clean(card.number);
      const expMonth = clean(card.expMonth);
      const expYear = clean(card.expYear);
      const cvv = clean(card.code);
      if (cardholder.length > 0) payload.cardholder = cardholder;
      if (brand.length > 0) payload.brand = brand;
      if (number.length > 0) payload.number = number;
      if (expMonth.length > 0) payload.expMonth = expMonth;
      if (expYear.length > 0) payload.expYear = expYear;
      if (cvv.length > 0) payload.cvv = cvv;
      if (notes.length > 0) payload.notes = notes;
      return { type: "card", payload };
    }
    case 4: {
      const identity = asRecord(item.identity);
      const pick = (key: string): string => clean(identity[key]);
      const payload: IdentityItem = { name };
      const fullName = [pick("title"), pick("firstName"), pick("middleName"), pick("lastName")]
        .filter((part) => part.length > 0)
        .join(" ");
      const address = [pick("address1"), pick("address2"), pick("state")]
        .filter((part) => part.length > 0)
        .join(", ");
      const idNumber = [pick("ssn"), pick("passportNumber"), pick("licenseNumber")].find(
        (part) => part.length > 0,
      );
      if (fullName.length > 0) payload.fullName = fullName;
      if (pick("email").length > 0) payload.email = pick("email");
      if (pick("phone").length > 0) payload.phone = pick("phone");
      if (address.length > 0) payload.address = address;
      if (pick("city").length > 0) payload.city = pick("city");
      if (pick("country").length > 0) payload.country = pick("country");
      if (pick("postalCode").length > 0) payload.postalCode = pick("postalCode");
      if (idNumber !== undefined) payload.idNumber = idNumber;
      if (notes.length > 0) payload.notes = notes;
      return { type: "identity", payload };
    }
    default:
      return null;
  }
}

function mapOnePasswordItem(raw: Record<string, unknown>): ImportedItem {
  const overview = asRecord(raw.overview);
  const details = asRecord(raw.details);
  const name = clean(overview.title).length > 0 ? clean(overview.title) : "Imported item";
  const notes = clean(details.notesPlain);
  const category = clean(raw.category).toUpperCase();
  const loginFields = Array.isArray(details.loginFields) ? details.loginFields : [];
  const field = (designation: string): string => {
    for (const entry of loginFields) {
      const record = asRecord(entry);
      if (clean(record.designation).toLowerCase() === designation) return clean(record.value);
    }
    return "";
  };
  const urls = [
    clean(overview.url),
    ...(Array.isArray(overview.urlList) ? overview.urlList.map((entry) => clean(asRecord(entry).url)) : []),
  ].filter((uri) => uri.length > 0);

  if (category === "LOGIN" || category === "PASSWORD") {
    const payload: LoginItem = { name };
    const username = field("username");
    const password = field("password");
    const totp = totpSecret(clean(details.totp) || clean(raw.totp));
    if (username.length > 0) payload.username = username;
    if (password.length > 0) payload.password = password;
    if (totp !== undefined) payload.totp = totp;
    if (urls.length > 0) payload.urls = [...new Set(urls)];
    if (notes.length > 0) payload.notes = notes;
    return { type: "login", payload };
  }
  if (category === "CREDIT_CARD") {
    const payload: CardItem = { name };
    const cardholder = clean(details.cardholder);
    const number = clean(details.ccNum);
    const expiry = clean(details.ccExpiry);
    if (cardholder.length > 0) payload.cardholder = cardholder;
    if (number.length > 0) payload.number = number;
    if (expiry.includes("/")) {
      const [month, year] = expiry.split("/");
      if (month !== undefined && month.trim().length > 0) payload.expMonth = month.trim();
      if (year !== undefined && year.trim().length > 0) payload.expYear = year.trim();
    }
    if (notes.length > 0) payload.notes = notes;
    return { type: "card", payload };
  }
  if (category === "IDENTITY" || category === "IDENTIFICATION") {
    const payload: IdentityItem = { name };
    const fullName = [clean(overview.title)].filter((part) => part.length > 0).join(" ");
    if (fullName.length > 0) payload.fullName = fullName;
    if (notes.length > 0) payload.notes = notes;
    return { type: "identity", payload };
  }
  return { type: "note", payload: { name, notes: notes.length > 0 ? notes : "" } };
}

function mapGenericItem(raw: Record<string, unknown>): ImportedItem | null {
  const name = clean(raw.name) || clean(raw.title) || clean(raw.item);
  const username = clean(raw.username) || clean(raw.user) || clean(raw.login);
  const password = clean(raw.password) || clean(raw.pass);
  const url = clean(raw.url) || clean(raw.uri) || clean(raw.website);
  const notes = clean(raw.notes) || clean(raw.note) || clean(raw.extra);
  const totp = totpSecret(clean(raw.totp) || clean(raw.otp));
  if (name.length === 0 && username.length === 0 && password.length === 0) return null;
  const payload: LoginItem = { name: name.length > 0 ? name : url.length > 0 ? url : "Imported item" };
  if (username.length > 0) payload.username = username;
  if (password.length > 0) payload.password = password;
  if (url.length > 0) payload.urls = [url];
  if (totp !== undefined) payload.totp = totp;
  if (notes.length > 0) payload.notes = notes;
  return { type: "login", payload };
}

function parseJsonExport(text: string): ImportedItem[] {
  const parsed: unknown = JSON.parse(text);
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed).items)
      ? (asRecord(parsed).items as unknown[])
      : [];
  if (items.length === 0) throw new Error("No items found in the JSON file");

  const first = asRecord(items[0]);
  const isBitwarden = "login" in first || "card" in first || "identity" in first || typeof first.type === "number";
  const isOnePassword = "overview" in first || "details" in first || "category" in first;

  return items
    .map((entry) => {
      const record = asRecord(entry);
      if (isBitwarden) return mapBitwardenItem(record as unknown as BitwardenItem);
      if (isOnePassword) return mapOnePasswordItem(record);
      return mapGenericItem(record);
    })
    .filter((item): item is ImportedItem => item !== null);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapCsv(text: string): ImportedItem[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV file has no data rows");
  const header = rows[0].map(normalizeHeader);
  const column = (...names: string[]): number => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };

  const colType = column("type", "category", "entrytype");
  const colName = column("name", "title", "item", "itemname", "entryname");
  const colNotes = column("notes", "note", "extra", "comments", "comment", "description", "securenote");
  const colUrl = column("url", "uri", "urls", "loginuri", "loginurl", "website", "webpage", "site");
  const colUsername = column("username", "user", "login", "loginusername", "email", "identity", "account");
  const colPassword = column("password", "pass", "pw", "loginpassword");
  const colTotp = column("totp", "otp", "logintotp", "twofactor", "2fa", "onetimepassword");
  const colCardholder = column("cardholder", "cardholdername", "nameoncard");
  const colNumber = column("cardnumber", "number", "ccnumber");
  const colExpMonth = column("expmonth", "expirationmonth", "expirymonth");
  const colExpYear = column("expyear", "expirationyear", "expiryear");
  const colCvv = column("cvv", "cvc", "securitycode", "code");

  return rows.slice(1).map((row) => {
    const at = (index: number): string => (index >= 0 ? clean(row[index]) : "");
    const rawType = at(colType).toLowerCase();
    const name = at(colName).length > 0 ? at(colName) : "Imported item";
    const notes = at(colNotes);

    if (rawType.includes("card") || (colNumber >= 0 && at(colNumber).length > 0 && at(colPassword).length === 0)) {
      const payload: CardItem = { name };
      const cardholder = at(colCardholder);
      const number = at(colNumber);
      const expMonth = at(colExpMonth);
      const expYear = at(colExpYear);
      const cvv = at(colCvv);
      if (cardholder.length > 0) payload.cardholder = cardholder;
      if (number.length > 0) payload.number = number;
      if (expMonth.length > 0) payload.expMonth = expMonth;
      if (expYear.length > 0) payload.expYear = expYear;
      if (cvv.length > 0) payload.cvv = cvv;
      if (notes.length > 0) payload.notes = notes;
      return { type: "card" as const, payload };
    }

    if (rawType.includes("note") && at(colPassword).length === 0 && at(colUsername).length === 0) {
      return { type: "note" as const, payload: { name, notes } satisfies NoteItem };
    }

    const payload: LoginItem = { name: name !== "Imported item" ? name : at(colUrl) || name };
    const username = at(colUsername);
    const password = at(colPassword);
    const totp = totpSecret(at(colTotp));
    const urls = at(colUrl)
      .split(/[\s,]+/)
      .map((uri) => uri.trim())
      .filter((uri) => uri.length > 0);
    if (username.length > 0) payload.username = username;
    if (password.length > 0) payload.password = password;
    if (totp !== undefined) payload.totp = totp;
    if (urls.length > 0) payload.urls = urls;
    if (notes.length > 0) payload.notes = notes;
    return { type: "login" as const, payload };
  });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntries(buffer: ArrayBuffer): Promise<Array<{ name: string; text: string }>> {
  const view = new DataView(buffer);
  let eocd = -1;
  const scanFrom = Math.max(0, buffer.byteLength - 22 - 65536);
  for (let i = buffer.byteLength - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file");

  const decoder = new TextDecoder("utf-8");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; text: string }> = [];

  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > buffer.byteLength) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buffer.byteLength) continue;
    const raw = new Uint8Array(buffer, dataStart, compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      continue;
    }
    entries.push({ name, text: decoder.decode(data) });
  }
  return entries;
}

export function parsePasswordExport(text: string): ImportedItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonExport(trimmed);
  }
  return mapCsv(trimmed);
}

export async function parsePasswordFile(file: File): Promise<ImportedItem[]> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const looksLikeZip =
    file.name.toLowerCase().endsWith(".zip") || (head[0] === 0x50 && head[1] === 0x4b);
  if (!looksLikeZip) {
    return parsePasswordExport(await file.text());
  }

  const entries = await readZipEntries(await file.arrayBuffer());
  if (entries.some((entry) => /encrypted\.json$/i.test(entry.name))) {
    throw new Error("That ZIP is an encrypted export. Export your vault without encryption first.");
  }
  const parseable = entries.filter(
    (entry) => /\.(json|csv)$/i.test(entry.name) && entry.text.trim().length > 0,
  );
  if (parseable.length === 0) {
    throw new Error("No JSON or CSV files found inside the ZIP");
  }
  const items: ImportedItem[] = [];
  for (const entry of parseable) {
    items.push(...parsePasswordExport(entry.text));
  }
  return items;
}
