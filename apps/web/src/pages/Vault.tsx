import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FolderItem, ItemPayload, ItemType, LoginItem, PasskeyItem } from "@toasty/crypto";
import {
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  FilterIcon,
  FolderIcon,
  KeyIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@toasty/icons";
import type { ItemRecord } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { ITEM_TYPES, ITEM_TYPE_META, emptyPayload, isItemType, secondaryText } from "../lib/items";
import { itemPath, navigate, newPath, vaultPath } from "../lib/routes";
import { formatRelativeTime } from "../lib/time";
import { useNowMs } from "../hooks";
import { useVault } from "../state/vault";
import { useToast } from "../components/Toasts";
import type { ContextMenuItem } from "../components/ContextMenu";
import { ContextMenu } from "../components/ContextMenu";
import { CopyButton } from "../components/CopyButton";
import { FolderSidebar } from "../components/FolderSidebar";
import { ItemEditor } from "../components/ItemEditor";
import { TotpChip } from "../components/Totp";

type Filter = "all" | ItemType;

export interface VaultPageProps {
  route:
    | { name: "vault"; folder: string | null }
    | { name: "item"; id: string; folder: string | null }
    | { name: "new"; type: ItemType; folder: string | null };
}

export interface FolderOption {
  id: string;
  name: string;
}

function itemTypeOf(record: ItemRecord): ItemType {
  return isItemType(record.type) ? record.type : "login";
}

function matchesQuery(record: ItemRecord, payload: ItemPayload | undefined, needle: string): boolean {
  if (needle.length === 0) return true;
  if (payload === undefined) return record.type.includes(needle);
  const haystack = `${payload.name} ${secondaryText(itemTypeOf(record), payload)}`.toLowerCase();
  return haystack.includes(needle);
}

export function VaultPage({ route }: VaultPageProps): JSX.Element {
  const vault = useVault();
  const { push } = useToast();
  const nowMs = useNowMs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; record: ItemRecord } | null>(null);
  const [itemMenuConfirm, setItemMenuConfirm] = useState<string | null>(null);
  const decrypted = vault.decrypted;

  const allItems = useMemo(
    () => vault.items.filter((record) => !record.deleted && record.type !== "folder"),
    [vault.items],
  );

  const folderOptions = useMemo<FolderOption[]>(() => {
    const rows: FolderOption[] = [];
    for (const record of vault.items) {
      if (record.deleted || record.type !== "folder") continue;
      const payload = decrypted.get(record.id);
      if (payload !== undefined) rows.push({ id: record.id, name: (payload as FolderItem).name });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [vault.items, decrypted]);

  const folderFilter = route.folder;

  const activeItems = useMemo(() => {
    if (folderFilter === null) return allItems;
    return allItems.filter(
      (record) =>
        (decrypted.get(record.id) as { folderId?: string } | undefined)?.folderId === folderFilter,
    );
  }, [allItems, decrypted, folderFilter]);

  useEffect(() => {
    setFilter("all");
  }, [folderFilter]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: activeItems.length,
      login: 0,
      passkey: 0,
      note: 0,
      card: 0,
      identity: 0,
      ssh: 0,
      api: 0,
    };
    for (const record of activeItems) result[itemTypeOf(record)] += 1;
    return result;
  }, [activeItems]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activeItems
      .filter((record) => filter === "all" || itemTypeOf(record) === filter)
      .filter((record) => matchesQuery(record, decrypted.get(record.id), needle))
      .sort((a, b) => {
        const nameA = decrypted.get(a.id)?.name ?? "";
        const nameB = decrypted.get(b.id)?.name ?? "";
        return nameA.localeCompare(nameB);
      });
  }, [activeItems, decrypted, filter, query]);

  const selected: { record: ItemRecord; type: ItemType; payload: ItemPayload } | null = (() => {
    if (route.name !== "item") return null;
    const record = allItems.find((entry) => entry.id === route.id);
    if (record === undefined) return null;
    const payload = decrypted.get(record.id);
    if (payload === undefined) return null;
    return { record, type: itemTypeOf(record), payload };
  })();

  const creating =
    route.name === "new"
      ? {
          type: route.type,
          payload: emptyPayload(route.type),
          folderId: route.folder,
        }
      : null;

  const onSave = async (type: ItemType, payload: ItemPayload): Promise<void> => {
    try {
      if (route.name === "new") {
        const id = await vault.addItem(type, payload);
        push("success", "Item saved");
        navigate(itemPath(id, folderFilter));
      } else if (route.name === "item") {
        await vault.updateItem(route.id, type, payload);
        push("success", "Item saved");
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Could not save the item");
    }
  };

  const onDelete = async (): Promise<void> => {
    if (route.name !== "item") return;
    try {
      await vault.deleteItem(route.id);
      push("success", "Item deleted");
      navigate(vaultPath(folderFilter));
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Could not delete the item");
    }
  };

  const editorOpen = selected !== null || creating !== null;

  const openItemMenu = (event: ReactMouseEvent, record: ItemRecord): void => {
    event.preventDefault();
    event.stopPropagation();
    setItemMenuConfirm(null);
    setItemMenu({ x: event.clientX, y: event.clientY, record });
  };

  const moveToFolder = async (record: ItemRecord, folderId: string | null): Promise<void> => {
    const payload = decrypted.get(record.id);
    if (payload === undefined) return;
    const next = { ...payload } as { folderId?: string };
    if (folderId === null) delete next.folderId;
    else next.folderId = folderId;
    try {
      await vault.updateItem(record.id, itemTypeOf(record), next as ItemPayload);
      push("success", folderId === null ? "Item removed from folder" : "Item moved to folder");
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Could not move the item");
    }
  };

  const itemMenuItems: ContextMenuItem[] = (() => {
    if (itemMenu === null) return [];
    const { record } = itemMenu;
    const type = itemTypeOf(record);
    const payload = decrypted.get(record.id);
    const login = type === "login" && payload !== undefined ? (payload as LoginItem) : null;
    const passkey = type === "passkey" && payload !== undefined ? (payload as PasskeyItem) : null;
    const items: ContextMenuItem[] = [
      {
        label: "Open item",
        Icon: ChevronRightIcon,
        onSelect: () => navigate(itemPath(record.id, folderFilter)),
      },
    ];
    if (login !== null && login.username !== undefined) {
      items.push({
        label: "Copy username",
        Icon: CopyIcon,
        onSelect: () => void copyText(login.username ?? ""),
      });
    }
    if (login !== null && login.password !== undefined) {
      items.push({
        label: "Copy password",
        Icon: CopyIcon,
        onSelect: () => void copyText(login.password ?? ""),
      });
    }
    if (passkey !== null && passkey.username !== undefined) {
      items.push({
        label: "Copy username",
        Icon: CopyIcon,
        onSelect: () => void copyText(passkey.username ?? ""),
      });
    }
    items.push({
      label: "Move to folder",
      Icon: FolderIcon,
      children: [
        {
          label: "No folder",
          Icon: FolderIcon,
          onSelect: () => void moveToFolder(record, null),
        },
        ...folderOptions.map((option) => ({
          label: option.name,
          Icon: FolderIcon,
          onSelect: () => void moveToFolder(record, option.id),
        })),
      ],
    });
    const confirming = itemMenuConfirm === record.id;
    items.push({
      label: confirming ? "Confirm delete item" : "Delete item",
      Icon: TrashIcon,
      danger: true,
      keepOpen: !confirming,
      onSelect: () => {
        if (!confirming) {
          setItemMenuConfirm(record.id);
          return;
        }
        setItemMenu(null);
        setItemMenuConfirm(null);
        void vault.deleteItem(record.id).then(() => {
          push("success", "Item deleted");
          if (route.name === "item" && route.id === record.id) navigate("/vault");
        });
      },
    });
    return items;
  })();

  return (
    <div>
      <header className="page-head">
        <h1 className="display">Vault</h1>
        <span className="label num">{activeItems.length} items</span>
        {folderFilter !== null ? (
          <button
            type="button"
            className="chip chip-active"
            title="Clear folder filter"
            onClick={() => navigate(vaultPath())}
          >
            <span>
              {folderOptions.find((option) => option.id === folderFilter)?.name ?? "Folder"}
            </span>
            <XIcon size={12} />
          </button>
        ) : null}
      </header>

      <div className={`vault-split${editorOpen ? " has-editor" : ""}`}>
        <FolderSidebar route={route} />
        <div className="list-pane">
          <div className="toolbar">
            <div className="search-wrap">
              <SearchIcon size={15} className="search-icon" />
              <input
                className="input"
                type="search"
                placeholder="Search your vault"
                value={query}
                aria-label="Search your vault"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  className="icon-btn search-clear"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => setQuery("")}
                >
                  <XIcon size={14} />
                </button>
              ) : null}
            </div>
            <div className="new-item-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMenuOpen((current) => !current)}
              >
                <PlusIcon size={16} />
                <span>New item</span>
              </button>
              {menuOpen ? (
                <>
                  <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="type-menu" role="menu">
                    {ITEM_TYPES.map((type) => {
                      const meta = ITEM_TYPE_META[type];
                      return (
                        <button
                          key={type}
                          type="button"
                          role="menuitem"
                          className="type-menu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            navigate(newPath(type, folderFilter));
                          }}
                        >
                          <meta.Icon size={16} />
                          <span>{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="filter-row" role="tablist" aria-label="Filter by type">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={`chip${filter === "all" ? " chip-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <FilterIcon size={13} />
              <span>All</span>
              <span className="chip-count num">{counts.all}</span>
            </button>
            {ITEM_TYPES.map((type) => {
              const meta = ITEM_TYPE_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={filter === type}
                  className={`chip${filter === type ? " chip-active" : ""}`}
                  onClick={() => setFilter(type)}
                >
                  <meta.Icon size={13} />
                  <span>{meta.plural}</span>
                  <span className="chip-count num">{counts[type]}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">
              {activeItems.length === 0 ? (
                <>
                  <span className="empty-icon">
                    <KeyIcon size={24} />
                  </span>
                  <h2 className="empty-title">
                    {folderFilter === null ? "Your vault is empty." : "This folder is empty."}
                  </h2>
                  <p className="muted">
                    {folderFilter === null
                      ? "Logins, passkeys, cards, and notes, encrypted on your device and readable only by you."
                      : "Create an item here, or file an existing item into this folder from its editor."}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate(newPath("login", folderFilter))}
                  >
                    <PlusIcon size={16} />
                    <span>Create your first item</span>
                  </button>
                </>
              ) : (
                <>
                  <h2 className="empty-title">Nothing matches that search.</h2>
                  <p className="muted">Try a different search or pick another filter.</p>
                </>
              )}
            </div>
          ) : (
            <ul className="item-list">
              {visible.map((record) => {
                const type = itemTypeOf(record);
                const meta = ITEM_TYPE_META[type];
                const payload = decrypted.get(record.id);
                const login = type === "login" && payload !== undefined ? (payload as LoginItem) : null;
                const passkey = type === "passkey" && payload !== undefined ? (payload as PasskeyItem) : null;
                const isActive = route.name === "item" && route.id === record.id;
                return (
                  <li key={record.id}>
                    <div
                      className={`item-row${isActive ? " item-row-active" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(itemPath(record.id, folderFilter))}
                      onContextMenu={(event) => openItemMenu(event, record)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(itemPath(record.id, folderFilter));
                        }
                      }}
                    >
                      <span className="item-icon" title={meta.label}>
                        <meta.Icon size={17} />
                      </span>
                      <div className="item-main">
                        <span className="item-name">{payload?.name ?? "Decrypting"}</span>
                        {payload !== undefined ? (
                          <span className={`item-sub${type === "login" ? " mono" : ""}`}>
                            {secondaryText(type, payload)}
                          </span>
                        ) : null}
                      </div>
                      {login !== null && login.totp !== undefined && login.totp.length > 0 ? (
                        <TotpChip secret={login.totp} nowMs={nowMs} />
                      ) : null}
                      <div className="item-actions">
                        {login !== null && login.username !== undefined ? (
                          <CopyButton value={login.username} compact title="Copy username" />
                        ) : null}
                        {login !== null && login.password !== undefined ? (
                          <CopyButton value={login.password} compact title="Copy password" />
                        ) : null}
                        {passkey !== null && passkey.username !== undefined ? (
                          <CopyButton value={passkey.username} compact title="Copy username" />
                        ) : null}
                      </div>
                      <span className="item-time">
                        <ClockIcon size={13} />
                        <span className="num">{formatRelativeTime(record.updatedAt)}</span>
                      </span>
                      <ChevronRightIcon size={14} className="item-chevron" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {editorOpen ? (
          <div className="editor-pane">
            <ItemEditor
              key={route.name === "item" ? route.id : `new-${creating?.type ?? "login"}`}
              type={selected !== null ? selected.type : (creating?.type ?? "login")}
              payload={selected !== null ? selected.payload : (creating?.payload ?? emptyPayload("login"))}
              isNew={creating !== null}
              folders={folderOptions}
              defaultFolderId={
                creating?.folderId ?? folderFilter
              }
              nowMs={nowMs}
              busy={vault.busy}
              onSave={onSave}
              onDelete={route.name === "item" ? onDelete : null}
              onClose={() => navigate("/vault")}
            />
          </div>
        ) : null}
      </div>

      {itemMenu !== null ? (
        <ContextMenu
          x={itemMenu.x}
          y={itemMenu.y}
          items={itemMenuItems}
          onClose={() => {
            setItemMenu(null);
            setItemMenuConfirm(null);
          }}
        />
      ) : null}

      {route.name === "item" && selected === null && !activeItems.some((entry) => entry.id === route.id) ? (
        <div className="empty-state">
          <h2 className="empty-title">Item not found.</h2>
          <p className="muted">It may have been deleted or is still syncing.</p>
          <button type="button" className="btn btn-outline" onClick={() => navigate("/vault")}>
            <KeyIcon size={16} />
            <span>Back to vault</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
