import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CheckIcon, FolderIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "@toasty/icons";
import type { ContextMenuItem } from "./ContextMenu";
import { ContextMenu } from "./ContextMenu";
import { ITEM_TYPES, ITEM_TYPE_META } from "../lib/items";
import type { Route } from "../lib/routes";
import { navigate, newPath, vaultPath } from "../lib/routes";
import { useVault } from "../state/vault";

interface FolderRow {
  id: string;
  name: string;
  count: number;
}

interface MenuState {
  x: number;
  y: number;
  folder: FolderRow | null;
}

export function FolderSidebar({ route }: { route: Route }): JSX.Element {
  const vault = useVault();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuConfirmId, setMenuConfirmId] = useState<string | null>(null);

  const folders = useMemo(() => {
    const names = new Map<string, string>();
    for (const record of vault.items) {
      if (record.deleted || record.type !== "folder") continue;
      const payload = vault.decrypted.get(record.id);
      if (payload !== undefined) names.set(record.id, payload.name);
    }
    const counts = new Map<string, number>();
    for (const id of names.keys()) counts.set(id, 0);
    let total = 0;
    for (const record of vault.items) {
      if (record.deleted || record.type === "folder") continue;
      total += 1;
      const folderId = (vault.decrypted.get(record.id) as { folderId?: string } | undefined)?.folderId;
      if (folderId !== undefined && counts.has(folderId)) {
        counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
      }
    }
    const rows: FolderRow[] = [...names.entries()]
      .map(([id, name]) => ({ id, name, count: counts.get(id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { rows, total };
  }, [vault.items, vault.decrypted]);

  const activeFolder =
    route.name === "vault" || route.name === "new" || route.name === "item" ? route.folder : null;

  const submitCreate = (): void => {
    const name = draftName.trim();
    if (name.length === 0) return;
    setCreating(false);
    setDraftName("");
    void vault.createFolder(name).then((id) => navigate(vaultPath(id)));
  };

  const startEdit = (folder: FolderRow): void => {
    setEditingId(folder.id);
    setEditName(folder.name);
    setConfirmDelete(false);
  };

  const submitRename = (): void => {
    const id = editingId;
    const name = editName.trim();
    if (id === null || name.length === 0) {
      setEditingId(null);
      return;
    }
    setEditingId(null);
    void vault.renameFolder(id, name);
  };

  const submitDelete = (): void => {
    const id = editingId;
    if (id === null) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setEditingId(null);
    setConfirmDelete(false);
    if (activeFolder === id) navigate(vaultPath());
    void vault.deleteFolder(id);
  };

  const openMenu = (event: ReactMouseEvent, folder: FolderRow | null): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenuConfirmId(null);
    setMenu({ x: event.clientX, y: event.clientY, folder });
  };

  const addItemsTo = (folderId: string | null): ContextMenuItem[] =>
    ITEM_TYPES.map((type) => {
      const meta = ITEM_TYPE_META[type];
      return {
        label: meta.label,
        Icon: meta.Icon,
        onSelect: () => navigate(newPath(type, folderId)),
      };
    });

  const menuItems: ContextMenuItem[] = (() => {
    if (menu === null) return [];
    const { folder } = menu;
    if (folder === null) {
      return [
        {
          label: "New folder",
          Icon: PlusIcon,
          onSelect: () => {
            setCreating(true);
            setDraftName("");
          },
        },
        { label: "Add item here", Icon: PlusIcon, children: addItemsTo(activeFolder) },
      ];
    }
    const confirming = menuConfirmId === folder.id;
    return [
      {
        label: "Open folder",
        Icon: FolderIcon,
        onSelect: () => navigate(vaultPath(folder.id)),
      },
      { label: "Add item to folder", Icon: PlusIcon, children: addItemsTo(folder.id) },
      {
        label: "Rename folder",
        Icon: PencilIcon,
        onSelect: () => startEdit(folder),
      },
      {
        label: confirming ? "Confirm delete folder" : "Delete folder",
        Icon: TrashIcon,
        danger: true,
        keepOpen: !confirming,
        onSelect: () => {
          if (!confirming) {
            setMenuConfirmId(folder.id);
            return;
          }
          setMenu(null);
          setMenuConfirmId(null);
          if (activeFolder === folder.id) navigate(vaultPath());
          void vault.deleteFolder(folder.id);
        },
      },
    ];
  })();

  return (
    <div className="folder-pane" onContextMenu={(event) => openMenu(event, null)}>
      <div className="folder-pane-head">
        <span className="label">Folders</span>
        <button
          type="button"
          className="icon-btn"
          title="New folder"
          aria-label="New folder"
          onClick={() => setCreating((current) => !current)}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {creating ? (
        <div className="folder-create">
          <input
            className="input"
            value={draftName}
            placeholder="Folder name"
            aria-label="Folder name"
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitCreate();
              if (event.key === "Escape") {
                setCreating(false);
                setDraftName("");
              }
            }}
          />
          <button type="button" className="icon-btn" title="Create folder" aria-label="Create folder" onClick={submitCreate}>
            <CheckIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Cancel"
            aria-label="Cancel"
            onClick={() => {
              setCreating(false);
              setDraftName("");
            }}
          >
            <XIcon size={14} />
          </button>
        </div>
      ) : null}
      <ul className="folder-list">
        <li>
          <button
            type="button"
            className={`folder-item${activeFolder === null ? " folder-item-active" : ""}`}
            onClick={() => navigate(vaultPath())}
          >
            <FolderIcon size={15} />
            <span className="folder-name truncate">All items</span>
            <span className="folder-count num">{folders.total}</span>
          </button>
        </li>
        {folders.rows.map((folder) =>
          editingId === folder.id ? (
            <li key={folder.id} className="folder-row">
              <input
                className="input folder-rename"
                value={editName}
                aria-label="Folder name"
                autoFocus
                onChange={(event) => setEditName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitRename();
                  if (event.key === "Escape") setEditingId(null);
                }}
              />
              <button type="button" className="icon-btn" title="Save name" aria-label="Save name" onClick={submitRename}>
                <CheckIcon size={14} />
              </button>
              <button
                type="button"
                className={`icon-btn${confirmDelete ? " icon-btn-danger" : ""}`}
                title={confirmDelete ? "Confirm delete" : "Delete folder"}
                aria-label={confirmDelete ? "Confirm delete folder" : "Delete folder"}
                onClick={submitDelete}
              >
                <TrashIcon size={14} />
              </button>
              <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel" onClick={() => setEditingId(null)}>
                <XIcon size={14} />
              </button>
            </li>
          ) : (
            <li key={folder.id} className="folder-row" onContextMenu={(event) => openMenu(event, folder)}>
              <button
                type="button"
                className={`folder-item${activeFolder === folder.id ? " folder-item-active" : ""}`}
                onClick={() => navigate(vaultPath(folder.id))}
              >
                <FolderIcon size={15} />
                <span className="folder-name truncate" title={folder.name}>
                  {folder.name}
                </span>
                <span className="folder-count num">{folder.count}</span>
              </button>
              <button
                type="button"
                className="icon-btn folder-edit"
                title={`Edit ${folder.name}`}
                aria-label={`Edit ${folder.name}`}
                onClick={() => startEdit(folder)}
              >
                <PencilIcon size={13} />
              </button>
            </li>
          ),
        )}
      </ul>
      {menu !== null ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => {
            setMenu(null);
            setMenuConfirmId(null);
          }}
        />
      ) : null}
    </div>
  );
}
