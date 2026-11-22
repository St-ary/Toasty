import type { ComponentType } from "react";
import type {
  ApiItem,
  CardItem,
  IdentityItem,
  ItemPayload,
  ItemType,
  LoginItem,
  NoteItem,
  PasskeyItem,
  SshItem,
} from "@toasty/crypto";
import type { IconProps } from "@toasty/icons";
import {
  BracesIcon,
  CreditCardIcon,
  FileTextIcon,
  IdCardIcon,
  KeyIcon,
  PasskeyIcon,
  TerminalIcon,
} from "@toasty/icons";

export interface ItemTypeMeta {
  label: string;
  plural: string;
  Icon: ComponentType<IconProps>;
}

export const ITEM_TYPES: readonly ItemType[] = [
  "login",
  "passkey",
  "note",
  "card",
  "identity",
  "ssh",
  "api",
];

export const ITEM_TYPE_META: Record<ItemType, ItemTypeMeta> = {
  login: { label: "Login", plural: "Logins", Icon: KeyIcon },
  passkey: { label: "Passkey", plural: "Passkeys", Icon: PasskeyIcon },
  note: { label: "Secure note", plural: "Notes", Icon: FileTextIcon },
  card: { label: "Card", plural: "Cards", Icon: CreditCardIcon },
  identity: { label: "Identity", plural: "Identities", Icon: IdCardIcon },
  ssh: { label: "SSH key", plural: "SSH keys", Icon: TerminalIcon },
  api: { label: "API key", plural: "API keys", Icon: BracesIcon },
};

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function emptyPayload(type: ItemType): ItemPayload {
  switch (type) {
    case "login":
      return { name: "" };
    case "note":
      return { name: "", notes: "" };
    case "card":
      return { name: "" };
    case "identity":
      return { name: "" };
    case "ssh":
      return { name: "" };
    case "api":
      return { name: "" };
    case "passkey":
      return { name: "" };
  }
}

export function maskSecret(value: string, visible = 4): string {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length <= visible) return trimmed;
  return "\u2022".repeat(Math.min(trimmed.length - visible, 12)) + trimmed.slice(-visible);
}

export function secondaryText(type: ItemType, payload: ItemPayload): string {
  switch (type) {
    case "login": {
      const item = payload as LoginItem;
      return item.username ?? (item.urls?.[0] ?? "");
    }
    case "note": {
      const item = payload as NoteItem;
      return item.notes.replace(/\s+/g, " ").slice(0, 80);
    }
    case "card": {
      const item = payload as CardItem;
      const number = item.number === undefined ? "" : maskSecret(item.number);
      return [item.brand ?? "", number].filter((part) => part.length > 0).join(" ");
    }
    case "identity": {
      const item = payload as IdentityItem;
      return item.email ?? item.fullName ?? item.phone ?? "";
    }
    case "ssh": {
      const item = payload as SshItem;
      return [item.keyType ?? "", item.host ?? item.username ?? item.fingerprint ?? ""]
        .filter((part) => part.length > 0)
        .join(" ");
    }
    case "api": {
      const item = payload as ApiItem;
      return item.baseUrl ?? item.username ?? (item.key === undefined ? "" : maskSecret(item.key));
    }
    case "passkey": {
      const item = payload as PasskeyItem;
      return [item.username ?? "", item.rpId ?? ""].filter((part) => part.length > 0).join(" · ");
    }
  }
}
