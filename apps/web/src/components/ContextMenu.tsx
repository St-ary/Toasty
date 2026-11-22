import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { IconProps } from "@toasty/icons";
import { ChevronRightIcon } from "@toasty/icons";

export interface ContextMenuItem {
  label: string;
  Icon?: ComponentType<IconProps>;
  danger?: boolean;
  keepOpen?: boolean;
  onSelect?: () => void;
  children?: ContextMenuItem[];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });
  const [expanded, setExpanded] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const element = menuRef.current;
      if (element !== null && element.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const renderItem = (item: ContextMenuItem): JSX.Element => {
    const hasChildren = item.children !== undefined && item.children.length > 0;
    const isOpen = hasChildren && expanded === item.label;
    return (
      <div key={item.label}>
        <button
          type="button"
          role="menuitem"
          className={`context-menu-item${item.danger === true ? " context-menu-item-danger" : ""}`}
          onClick={() => {
            if (hasChildren) {
              setExpanded(isOpen ? null : item.label);
              return;
            }
            item.onSelect?.();
            if (item.keepOpen !== true) onClose();
          }}
        >
          {item.Icon !== undefined ? <item.Icon size={15} /> : null}
          <span className="context-menu-label truncate">{item.label}</span>
          {hasChildren ? (
            <ChevronRightIcon
              size={13}
              className={`context-menu-chevron${isOpen ? " context-menu-chevron-open" : ""}`}
            />
          ) : null}
        </button>
        {isOpen ? (
          <div className="context-menu-children" role="group">
            {item.children?.map((child) => renderItem(child))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => renderItem(item))}
    </div>
  );
}
