import { createContext, useContext, useState } from "react";
import type {
  ApiItem,
  CardItem,
  CustomField,
  IdentityItem,
  ItemPayload,
  ItemType,
  LoginItem,
  NoteItem,
  PasskeyItem,
  SshItem,
} from "@toasty/crypto";
import { generatePassword, generateTotpSecret, normalizeTotpSecret } from "@toasty/crypto";
import {
  CheckIcon,
  DicesIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
  XIcon,
} from "@toasty/icons";
import { CopyButton } from "./CopyButton";
import { StrengthMeter } from "./StrengthMeter";
import { TotpRow } from "./Totp";
import { ITEM_TYPE_META, maskSecret } from "../lib/items";

const EditorReadOnly = createContext(false);

interface Draft {
  name: string;
  username: string;
  password: string;
  urls: string;
  totp: string;
  notes: string;
  customFields: CustomField[];
  cardholder: string;
  brand: string;
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  pin: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  postalCode: string;
  idNumber: string;
  keyType: string;
  publicKey: string;
  privateKey: string;
  passphrase: string;
  host: string;
  port: string;
  fingerprint: string;
  key: string;
  baseUrl: string;
  rpId: string;
  userHandle: string;
  credentialId: string;
  signCount: string;
  created: string;
  folderId: string;
  autofill: boolean;
}

function emptyDraft(): Draft {
  return {
    name: "",
    username: "",
    password: "",
    urls: "",
    totp: "",
    notes: "",
    customFields: [],
    cardholder: "",
    brand: "",
    number: "",
    expMonth: "",
    expYear: "",
    cvv: "",
    pin: "",
    fullName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    country: "",
    postalCode: "",
    idNumber: "",
    keyType: "",
    publicKey: "",
    privateKey: "",
    passphrase: "",
    host: "",
    port: "",
    fingerprint: "",
    key: "",
    baseUrl: "",
    rpId: "",
    userHandle: "",
    credentialId: "",
    signCount: "",
    created: "",
    folderId: "",
    autofill: true,
  };
}

function toDraft(type: ItemType, payload: ItemPayload): Draft {
  const fields = payload as { folderId?: string; autofill?: boolean };
  const base: Draft = {
    ...emptyDraft(),
    folderId: fields.folderId ?? "",
    autofill: fields.autofill !== false,
  };
  switch (type) {
    case "login": {
      const item = payload as LoginItem;
      return {
        ...base,
        name: item.name,
        username: item.username ?? "",
        password: item.password ?? "",
        urls: (item.urls ?? []).join("\n"),
        totp: item.totp ?? "",
        notes: item.notes ?? "",
        customFields: (item.customFields ?? []).map((field) => ({ ...field })),
      };
    }
    case "note": {
      const item = payload as NoteItem;
      return { ...base, name: item.name, notes: item.notes };
    }
    case "card": {
      const item = payload as CardItem;
      return {
        ...base,
        name: item.name,
        cardholder: item.cardholder ?? "",
        brand: item.brand ?? "",
        number: item.number ?? "",
        expMonth: item.expMonth ?? "",
        expYear: item.expYear ?? "",
        cvv: item.cvv ?? "",
        pin: item.pin ?? "",
        notes: item.notes ?? "",
      };
    }
    case "identity": {
      const item = payload as IdentityItem;
      return {
        ...base,
        name: item.name,
        fullName: item.fullName ?? "",
        email: item.email ?? "",
        phone: item.phone ?? "",
        address: item.address ?? "",
        city: item.city ?? "",
        country: item.country ?? "",
        postalCode: item.postalCode ?? "",
        idNumber: item.idNumber ?? "",
        notes: item.notes ?? "",
      };
    }
    case "ssh": {
      const item = payload as SshItem;
      return {
        ...base,
        name: item.name,
        keyType: item.keyType ?? "",
        publicKey: item.publicKey ?? "",
        privateKey: item.privateKey ?? "",
        passphrase: item.passphrase ?? "",
        host: item.host ?? "",
        port: item.port ?? "",
        username: item.username ?? "",
        fingerprint: item.fingerprint ?? "",
        notes: item.notes ?? "",
      };
    }
    case "api": {
      const item = payload as ApiItem;
      return {
        ...base,
        name: item.name,
        key: item.key ?? "",
        baseUrl: item.baseUrl ?? "",
        username: item.username ?? "",
        notes: item.notes ?? "",
      };
    }
    case "passkey": {
      const item = payload as PasskeyItem;
      return {
        ...base,
        name: item.name,
        username: item.username ?? "",
        rpId: item.rpId ?? "",
        userHandle: item.userHandle ?? "",
        credentialId: item.credentialId ?? "",
        privateKey: item.privateKey ?? "",
        publicKey: item.publicKey ?? "",
        signCount: item.signCount === undefined ? "" : String(item.signCount),
        created: item.created ?? "",
        notes: item.notes ?? "",
      };
    }
  }
}

function buildPayload(type: ItemType, draft: Draft): ItemPayload {
  switch (type) {
    case "login": {
      const payload: LoginItem = { name: draft.name.trim() };
      const username = draft.username.trim();
      if (username.length > 0) payload.username = username;
      if (draft.password.length > 0) payload.password = draft.password;
      const urls = draft.urls
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (urls.length > 0) payload.urls = urls;
      const totp = normalizeTotpSecret(draft.totp);
      if (totp !== null && totp.length > 0) payload.totp = totp;
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      const customFields = draft.customFields
        .map((field) => ({ ...field, name: field.name.trim() }))
        .filter((field) => field.name.length > 0 || field.value.length > 0);
      if (customFields.length > 0) payload.customFields = customFields;
      return payload;
    }
    case "note": {
      const payload: NoteItem = { name: draft.name.trim(), notes: draft.notes };
      return payload;
    }
    case "card": {
      const payload: CardItem = { name: draft.name.trim() };
      if (draft.cardholder.trim().length > 0) payload.cardholder = draft.cardholder.trim();
      if (draft.brand.trim().length > 0) payload.brand = draft.brand.trim();
      if (draft.number.trim().length > 0) payload.number = draft.number.trim();
      if (draft.expMonth.trim().length > 0) payload.expMonth = draft.expMonth.trim();
      if (draft.expYear.trim().length > 0) payload.expYear = draft.expYear.trim();
      if (draft.cvv.length > 0) payload.cvv = draft.cvv;
      if (draft.pin.length > 0) payload.pin = draft.pin;
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      return payload;
    }
    case "identity": {
      const payload: IdentityItem = { name: draft.name.trim() };
      if (draft.fullName.trim().length > 0) payload.fullName = draft.fullName.trim();
      if (draft.email.trim().length > 0) payload.email = draft.email.trim();
      if (draft.phone.trim().length > 0) payload.phone = draft.phone.trim();
      if (draft.address.trim().length > 0) payload.address = draft.address.trim();
      if (draft.city.trim().length > 0) payload.city = draft.city.trim();
      if (draft.country.trim().length > 0) payload.country = draft.country.trim();
      if (draft.postalCode.trim().length > 0) payload.postalCode = draft.postalCode.trim();
      if (draft.idNumber.trim().length > 0) payload.idNumber = draft.idNumber.trim();
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      return payload;
    }
    case "ssh": {
      const payload: SshItem = { name: draft.name.trim() };
      if (draft.keyType.trim().length > 0) payload.keyType = draft.keyType.trim();
      if (draft.publicKey.trim().length > 0) payload.publicKey = draft.publicKey;
      if (draft.privateKey.length > 0) payload.privateKey = draft.privateKey;
      if (draft.passphrase.length > 0) payload.passphrase = draft.passphrase;
      if (draft.host.trim().length > 0) payload.host = draft.host.trim();
      if (draft.port.trim().length > 0) payload.port = draft.port.trim();
      if (draft.username.trim().length > 0) payload.username = draft.username.trim();
      if (draft.fingerprint.trim().length > 0) payload.fingerprint = draft.fingerprint.trim();
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      return payload;
    }
    case "api": {
      const payload: ApiItem = { name: draft.name.trim() };
      if (draft.key.length > 0) payload.key = draft.key;
      if (draft.baseUrl.trim().length > 0) payload.baseUrl = draft.baseUrl.trim();
      if (draft.username.trim().length > 0) payload.username = draft.username.trim();
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      return payload;
    }
    case "passkey": {
      const payload: PasskeyItem = { name: draft.name.trim() };
      if (draft.username.trim().length > 0) payload.username = draft.username.trim();
      if (draft.rpId.trim().length > 0) payload.rpId = draft.rpId.trim();
      if (draft.userHandle.trim().length > 0) payload.userHandle = draft.userHandle.trim();
      if (draft.credentialId.trim().length > 0) payload.credentialId = draft.credentialId.trim();
      if (draft.privateKey.length > 0) payload.privateKey = draft.privateKey;
      if (draft.publicKey.trim().length > 0) payload.publicKey = draft.publicKey.trim();
      const signCount = Number.parseInt(draft.signCount, 10);
      if (Number.isInteger(signCount) && signCount >= 0) payload.signCount = signCount;
      if (draft.created.trim().length > 0) payload.created = draft.created.trim();
      if (draft.notes.trim().length > 0) payload.notes = draft.notes;
      return payload;
    }
  }
}

function toPayload(type: ItemType, draft: Draft): ItemPayload {
  const payload = buildPayload(type, draft);
  const withExtras = payload as { folderId?: string; autofill?: boolean };
  if (draft.folderId.length > 0) withExtras.folderId = draft.folderId;
  if (type === "login" || type === "passkey") withExtras.autofill = draft.autofill;
  return payload;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
}

function Field({ label, value, onChange, mono = false, placeholder }: FieldProps): JSX.Element {
  const readOnly = useContext(EditorReadOnly);
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className={`input${mono ? " input-mono" : ""}`}
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SecretField({
  label,
  value,
  onChange,
  hidden = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hidden?: boolean;
  placeholder?: string;
}): JSX.Element {
  const [visible, setVisible] = useState(!hidden);
  const readOnly = useContext(EditorReadOnly);
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="secret-input">
        <input
          className="input input-mono"
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={visible ? "Hide" : "Show"}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
        <CopyButton value={value} compact title={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

export interface ItemEditorProps {
  type: ItemType;
  payload: ItemPayload;
  isNew: boolean;
  folders: Array<{ id: string; name: string }>;
  defaultFolderId: string | null;
  nowMs: number;
  busy: boolean;
  onSave: (type: ItemType, payload: ItemPayload) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}

export function ItemEditor({
  type,
  payload,
  isNew,
  folders,
  defaultFolderId,
  nowMs,
  busy,
  onSave,
  onDelete,
  onClose,
}: ItemEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => {
    const initial = toDraft(type, payload);
    if (isNew && defaultFolderId !== null) initial.folderId = defaultFolderId;
    return initial;
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showNumber, setShowNumber] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(isNew);
  const readOnly = !editing;

  const meta = ITEM_TYPE_META[type];

  const update = (patch: Partial<Draft>): void => {
    if (readOnly) return;
    setDraft((current) => ({ ...current, ...patch }));
  };

  const save = (): void => {
    if (draft.name.trim().length === 0) {
      setError("A name is required");
      return;
    }
    if (draft.totp.trim().length > 0 && normalizeTotpSecret(draft.totp) === null) {
      setError("The authenticator secret is not valid. Paste the key or the full otpauth:// link.");
      return;
    }
    setError(null);
    void onSave(type, toPayload(type, draft))
      .then(() => setEditing(false))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"));
  };

  const cancelEdit = (): void => {
    setDraft(toDraft(type, payload));
    setError(null);
    setConfirmDelete(false);
    setEditing(false);
  };

  const remove = (): void => {
    if (onDelete === null) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void onDelete();
  };

  return (
    <EditorReadOnly.Provider value={readOnly}>
    <section className="editor" aria-label={isNew ? `New ${meta.label}` : `Edit ${meta.label}`}>
      <header className="editor-head">
        <div className="editor-head-main">
          <span className="label">{isNew ? `New ${meta.label}` : readOnly ? meta.label : `Edit ${meta.label}`}</span>
          <input
            className="editor-title-input"
            type="text"
            value={draft.name}
            placeholder="Untitled"
            aria-label="Title"
            readOnly={readOnly}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
        <button type="button" className="icon-btn" aria-label="Close editor" title="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </header>

      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="editor-body">
        <div className="field">
          <span className="label">Folder</span>
          <select
            className="input select"
            value={draft.folderId}
            disabled={readOnly}
            onChange={(event) => update({ folderId: event.target.value })}
          >
            <option value="">No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        {type === "login" || type === "passkey" ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.autofill}
              disabled={readOnly}
              onChange={(event) => update({ autofill: event.target.checked })}
            />
            <span>
              {type === "login"
                ? "Fill automatically on matching sites"
                : "Sign in with this passkey automatically"}
            </span>
          </label>
        ) : null}
        {type === "login" ? (
          <>
            <Field
              label="Username"
              value={draft.username}
              onChange={(username) => update({ username })}
              placeholder="name@example.com"
            />
            <div className="field">
              <span className="label">Password</span>
              <div className="secret-input">
                <input
                  className="input input-mono"
                  type={showPassword ? "text" : "password"}
                  value={draft.password}
                  placeholder="Empty for none"
                  autoComplete="new-password"
                  onChange={(event) => update({ password: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide" : "Show"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={draft.password} compact title="Copy password" />
                {!readOnly ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => update({ password: generatePassword() })}
                  >
                    <DicesIcon size={15} />
                    <span>Generate</span>
                  </button>
                ) : null}
              </div>
              <StrengthMeter password={draft.password} showBits />
            </div>
            <label className="field">
              <span className="label">URLs (one per line)</span>
              <textarea
                className="input textarea input-mono"
                rows={2}
                value={draft.urls}
                placeholder="https://example.com"
                readOnly={readOnly}
                onChange={(event) => update({ urls: event.target.value })}
              />
            </label>
            <div className="field">
              <span className="label">Authenticator secret</span>
              {readOnly ? (
                <div className="secret-input">
                  <span className="masked-value mono">
                    {draft.totp.trim().length > 0 ? maskSecret(draft.totp) : "Not set"}
                  </span>
                  {draft.totp.trim().length > 0 ? (
                    <CopyButton value={draft.totp} compact title="Copy secret" />
                  ) : null}
                </div>
              ) : (
                <div className="secret-input">
                  <input
                    className="input input-mono"
                    type={showTotp ? "text" : "password"}
                    value={draft.totp}
                    placeholder="Base32 secret or otpauth:// link"
                    autoComplete="off"
                    onChange={(event) => update({ totp: event.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={showTotp ? "Hide authenticator secret" : "Show authenticator secret"}
                    title={showTotp ? "Hide" : "Show"}
                    onClick={() => setShowTotp((current) => !current)}
                  >
                    {showTotp ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                  </button>
                  <CopyButton value={draft.totp} compact title="Copy secret" />
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => update({ totp: generateTotpSecret() })}
                  >
                    <SparkIcon size={15} />
                    <span>Add authenticator</span>
                  </button>
                </div>
              )}
              {draft.totp.trim().length > 0 ? <TotpRow secret={draft.totp} nowMs={nowMs} /> : null}
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
            <div className="field">
              <span className="label">Custom fields</span>
              {draft.customFields.map((field, index) => (
                <div className="custom-field" key={index}>
                  <input
                    className="input"
                    value={field.name}
                    placeholder="Field name"
                    readOnly={readOnly}
                    onChange={(event) => {
                      const customFields = draft.customFields.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, name: event.target.value } : entry,
                      );
                      update({ customFields });
                    }}
                  />
                  <input
                    className="input input-mono"
                    value={field.value}
                    placeholder="Value"
                    readOnly={readOnly}
                    onChange={(event) => {
                      const customFields = draft.customFields.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, value: event.target.value } : entry,
                      );
                      update({ customFields });
                    }}
                  />
                  <CopyButton value={field.value} compact title="Copy value" />
                  {!readOnly ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove custom field"
                      title="Remove field"
                      onClick={() => update({ customFields: draft.customFields.filter((_, i) => i !== index) })}
                    >
                      <XIcon size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
              {!readOnly ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => update({ customFields: [...draft.customFields, { name: "", value: "" }] })}
                >
                  <PlusIcon size={15} />
                  <span>Add field</span>
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {type === "note" ? (
          <label className="field">
            <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={10}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
          </label>
        ) : null}

        {type === "card" ? (
          <>
            <Field
              label="Cardholder"
              value={draft.cardholder}
              onChange={(cardholder) => update({ cardholder })}
            />
            <Field label="Brand" value={draft.brand} onChange={(brand) => update({ brand })} placeholder="Visa" />
            <div className="field">
              <span className="label">Card number</span>
              <div className="secret-input">
                {showNumber ? (
                  <input
                    className="input input-mono"
                    type="text"
                    value={draft.number}
                    placeholder="0000 0000 0000 0000"
                    autoComplete="off"
                    readOnly={readOnly}
                    onChange={(event) => update({ number: event.target.value })}
                  />
                ) : (
                  <span className="masked-value mono">
                    {draft.number.trim().length > 0 ? maskSecret(draft.number) : "Not set"}
                  </span>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showNumber ? "Hide card number" : "Show card number"}
                  title={showNumber ? "Hide card number" : "Show card number"}
                  onClick={() => setShowNumber((current) => !current)}
                >
                  {showNumber ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={draft.number} compact title="Copy card number" />
              </div>
            </div>
            <div className="field-row">
              <Field
                label="Expiry month"
                value={draft.expMonth}
                onChange={(expMonth) => update({ expMonth })}
                placeholder="MM"
              />
              <Field
                label="Expiry year"
                value={draft.expYear}
                onChange={(expYear) => update({ expYear })}
                placeholder="YYYY"
              />
            </div>
            <div className="field-row">
              <SecretField label="CVV" value={draft.cvv} onChange={(cvv) => update({ cvv })} hidden />
              <SecretField label="PIN" value={draft.pin} onChange={(pin) => update({ pin })} hidden />
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </>
        ) : null}

        {type === "identity" ? (
          <>
            <Field label="Full name" value={draft.fullName} onChange={(fullName) => update({ fullName })} />
            <Field label="Email" value={draft.email} onChange={(email) => update({ email })} />
            <Field label="Phone" value={draft.phone} onChange={(phone) => update({ phone })} />
            <Field label="Address" value={draft.address} onChange={(address) => update({ address })} />
            <div className="field-row">
              <Field label="City" value={draft.city} onChange={(city) => update({ city })} />
              <Field label="Country" value={draft.country} onChange={(country) => update({ country })} />
            </div>
            <div className="field-row">
              <Field
                label="Postal code"
                value={draft.postalCode}
                onChange={(postalCode) => update({ postalCode })}
              />
              <SecretField label="ID number" value={draft.idNumber} onChange={(idNumber) => update({ idNumber })} />
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </>
        ) : null}

        {type === "ssh" ? (
          <>
            <div className="field-row">
              <Field
                label="Key type"
                value={draft.keyType}
                onChange={(keyType) => update({ keyType })}
                placeholder="ed25519"
              />
              <SecretField label="Key passphrase" value={draft.passphrase} onChange={(passphrase) => update({ passphrase })} hidden />
            </div>
            <label className="field">
              <span className="label">Public key</span>
              <textarea
                className="input textarea input-mono"
                rows={3}
                value={draft.publicKey}
                placeholder="ssh-ed25519 AAAA..."
                readOnly={readOnly}
                onChange={(event) => update({ publicKey: event.target.value })}
              />
            </label>
            <div className="field">
              <span className="label">Private key</span>
              <div className="secret-input">
                <textarea
                  className="input textarea input-mono"
                  rows={4}
                  value={draft.privateKey}
                  placeholder={showPassword ? "-----BEGIN OPENSSH PRIVATE KEY-----" : "Hidden"}
                  readOnly={readOnly}
                  onChange={(event) => update({ privateKey: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? "Hide private key" : "Show private key"}
                  title={showPassword ? "Hide" : "Show"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={draft.privateKey} compact title="Copy private key" />
              </div>
            </div>
            <div className="field-row">
              <Field label="Host" value={draft.host} onChange={(host) => update({ host })} placeholder="git.example.com" />
              <Field label="Port" value={draft.port} onChange={(port) => update({ port })} placeholder="22" />
            </div>
            <div className="field-row">
              <Field label="Username" value={draft.username} onChange={(username) => update({ username })} placeholder="git" />
              <Field label="Fingerprint" value={draft.fingerprint} onChange={(fingerprint) => update({ fingerprint })} mono />
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </>
        ) : null}

        {type === "api" ? (
          <>
            <div className="field">
              <span className="label">API key</span>
              <div className="secret-input">
                <input
                  className="input input-mono"
                  type={showPassword ? "text" : "password"}
                  value={draft.key}
                  placeholder="Token or key"
                  autoComplete="off"
                  onChange={(event) => update({ key: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? "Hide API key" : "Show API key"}
                  title={showPassword ? "Hide" : "Show"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={draft.key} compact title="Copy API key" />
                {!readOnly ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => update({ key: generatePassword({ length: 40, symbols: false }) })}
                  >
                    <DicesIcon size={15} />
                    <span>Generate</span>
                  </button>
                ) : null}
              </div>
            </div>
            <Field
              label="Service URL"
              value={draft.baseUrl}
              onChange={(baseUrl) => update({ baseUrl })}
              placeholder="https://api.example.com"
              mono
            />
            <Field label="Username" value={draft.username} onChange={(username) => update({ username })} />
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </>
        ) : null}

        {type === "passkey" ? (
          <>
            <div className="field-row">
              <Field
                label="Relying party"
                value={draft.rpId}
                onChange={(rpId) => update({ rpId })}
                placeholder="example.com"
                mono
              />
              <Field
                label="Username"
                value={draft.username}
                onChange={(username) => update({ username })}
                placeholder="name@example.com"
              />
            </div>
            <div className="field-row">
              <Field label="Credential ID" value={draft.credentialId} onChange={(credentialId) => update({ credentialId })} mono />
              <Field label="User handle" value={draft.userHandle} onChange={(userHandle) => update({ userHandle })} mono />
            </div>
            <div className="field">
              <span className="label">Private key</span>
              <div className="secret-input">
                <textarea
                  className="input textarea input-mono"
                  rows={3}
                  value={draft.privateKey}
                  placeholder={showPassword ? "PKCS#8 key (base64url)" : "Hidden"}
                  readOnly={readOnly}
                  onChange={(event) => update({ privateKey: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? "Hide private key" : "Show private key"}
                  title={showPassword ? "Hide" : "Show"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                </button>
                <CopyButton value={draft.privateKey} compact title="Copy private key" />
              </div>
            </div>
            <label className="field">
              <span className="label">Public key (COSE)</span>
              <textarea
                className="input textarea input-mono"
                rows={2}
                value={draft.publicKey}
                placeholder="COSE key (base64url)"
                readOnly={readOnly}
                onChange={(event) => update({ publicKey: event.target.value })}
              />
            </label>
            <div className="field-row">
              <Field
                label="Sign counter"
                value={draft.signCount}
                onChange={(signCount) => update({ signCount })}
                placeholder="0"
                mono
              />
              <Field label="Created" value={draft.created} onChange={(created) => update({ created })} mono />
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.notes}
                readOnly={readOnly}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>

      <footer className="editor-actions">
        {editing ? (
          <>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
              <CheckIcon size={16} />
              <span>Save</span>
            </button>
            {!isNew ? (
              <button type="button" className="btn btn-quiet" onClick={cancelEdit} disabled={busy}>
                <XIcon size={16} />
                <span>Cancel</span>
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)} disabled={busy}>
            <PencilIcon size={16} />
            <span>Edit</span>
          </button>
        )}
        {onDelete !== null ? (
          <button
            type="button"
            className={`btn ${confirmDelete ? "btn-danger-solid" : "btn-danger"}`}
            onClick={remove}
            disabled={busy}
          >
            <TrashIcon size={16} />
            <span>{confirmDelete ? "Confirm delete" : "Delete"}</span>
          </button>
        ) : null}
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          <XIcon size={16} />
          <span>Close</span>
        </button>
      </footer>
    </section>
    </EditorReadOnly.Provider>
  );
}
