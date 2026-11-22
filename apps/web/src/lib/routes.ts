import type { ItemType } from "@toasty/crypto";
import { isItemType } from "./items";

export type Route =
  | { name: "login" }
  | { name: "vault"; folder: string | null }
  | { name: "item"; id: string; folder: string | null }
  | { name: "new"; type: ItemType; folder: string | null }
  | { name: "tools" }
  | { name: "settings" };

export function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#/, "");
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { name: "login" };
  const [root, kind, id, fourth, fifth] = segments;
  if (root === "vault") {
    if (kind === "item" && id !== undefined && id.length > 0) {
      return { name: "item", id, folder: null };
    }
    if (kind === "new" && id !== undefined && isItemType(id)) {
      return { name: "new", type: id, folder: null };
    }
    if (kind === "folder" && id !== undefined && id.length > 0) {
      if (fourth === "item" && fifth !== undefined && fifth.length > 0) {
        return { name: "item", id: fifth, folder: id };
      }
      if (fourth === "new" && fifth !== undefined && isItemType(fifth)) {
        return { name: "new", type: fifth, folder: id };
      }
      return { name: "vault", folder: id };
    }
    return { name: "vault", folder: null };
  }
  if (root === "tools") return { name: "tools" };
  if (root === "settings") return { name: "settings" };
  return { name: "login" };
}

export function navigate(path: string): void {
  window.location.hash = `#${path}`;
}

export function itemPath(id: string, folder?: string | null): string {
  if (folder === undefined || folder === null) return `/vault/item/${id}`;
  return `/vault/folder/${folder}/item/${id}`;
}

export function newPath(type: ItemType, folder?: string | null): string {
  if (folder === undefined || folder === null) return `/vault/new/${type}`;
  return `/vault/folder/${folder}/new/${type}`;
}

export function vaultPath(folder?: string | null): string {
  if (folder === undefined || folder === null) return "/vault";
  return `/vault/folder/${folder}`;
}
