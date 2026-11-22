export interface BadgeEntry {
  id: string;
  label: string;
  sublabel: string;
  hasUsername: boolean;
  hasPassword: boolean;
  hasTotp: boolean;
}

export type BadgeField = "username" | "password" | "code";

interface Badge {
  host: HTMLElement;
  anchor: HTMLElement;
  menu: HTMLElement;
}

const ACCENT = "#c68b59";
const ACCENT_CONTRAST = "#ffffff";
const SURFACE = "#ffffff";
const SURFACE_2 = "#faebd7";
const BORDER = "#e8c39e";
const TEXT = "#2b1a0e";
const TEXT_MUTED = "#7a5c43";

const STYLE = `
:host { all: initial; }
.wrap { position: absolute; top: 0; left: 0; font-family: system-ui, sans-serif; }
.chip {
  width: 22px; height: 22px; border-radius: 7px; border: 1px solid ${BORDER};
  background: ${ACCENT}; color: ${ACCENT_CONTRAST}; font: 700 12px/1 Georgia, serif;
  cursor: pointer; padding: 0; box-shadow: 0 1px 4px rgba(43, 26, 14, 0.35);
}
.chip:hover { filter: brightness(1.06); }
.menu {
  position: absolute; top: 26px; right: 0; min-width: 220px; max-height: 260px; overflow-y: auto;
  background: ${SURFACE}; color: ${TEXT}; border: 1px solid ${BORDER}; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(43, 26, 14, 0.28); padding: 6px; z-index: 2147483647;
}
.menu[hidden] { display: none; }
.title {
  font: 600 11px/1.4 system-ui, sans-serif; color: ${TEXT_MUTED};
  text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 8px;
}
.entry {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  border-radius: 8px; padding: 7px 8px; cursor: pointer;
}
.entry:hover { background: ${SURFACE_2}; }
.entry .label { display: block; font: 600 13px/1.3 system-ui, sans-serif; color: ${TEXT}; }
.entry .sublabel { display: block; font: 400 12px/1.3 system-ui, sans-serif; color: ${TEXT_MUTED}; }
.entry-row { display: flex; align-items: center; gap: 2px; }
.entry-row .entry { flex: 1; min-width: 0; }
.entry-field {
  width: 26px; height: 26px; flex-shrink: 0; border: 0; border-radius: 7px;
  background: transparent; color: ${TEXT_MUTED}; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; padding: 0;
}
.entry-field:hover { background: ${SURFACE_2}; color: ${TEXT}; }
@media (prefers-color-scheme: dark) {
  .menu { background: #2f2117; color: #f7ede2; border-color: #5b3a22; }
  .entry:hover { background: #3a2415; }
  .entry .label { color: #f7ede2; }
  .entry .sublabel, .title { color: #c9b39c; }
}
`;

let badges: Badge[] = [];
let selectHandler: ((id: string) => void) | null = null;
let fieldHandler: ((id: string, field: BadgeField) => void) | null = null;

const FIELD_ICONS: Record<BadgeField, string> = {
  username:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  password:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8m-3 3l3 3"/></svg>',
  code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

const FIELD_TITLES: Record<BadgeField, string> = {
  username: "Fill username",
  password: "Fill password",
  code: "Fill authenticator code",
};

function positionBadge(badge: Badge): void {
  const rect = badge.anchor.getBoundingClientRect();
  const left = Math.max(4, Math.min(window.innerWidth - 30, rect.right - 22));
  const top = Math.max(4, Math.min(window.innerHeight - 30, rect.top + rect.height / 2 - 11));
  badge.host.style.left = `${left}px`;
  badge.host.style.top = `${top}px`;
}

function repositionAll(): void {
  for (const badge of badges) positionBadge(badge);
}

function closeMenus(): void {
  for (const badge of badges) badge.menu.hidden = true;
}

function onDocumentClick(event: Event): void {
  const path = event.composedPath();
  const inside = badges.some((badge) => path.includes(badge.host));
  if (!inside) closeMenus();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") hideBadges();
}

function createBadge(anchor: HTMLElement, entries: BadgeEntry[]): Badge {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const chip = document.createElement("button");
  chip.className = "chip";
  chip.type = "button";
  chip.textContent = "T";
  chip.title = "Toasty logins";

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.hidden = true;

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Logins";
  menu.appendChild(title);

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "entry-row";
    const button = document.createElement("button");
    button.className = "entry";
    button.type = "button";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = entry.label;
    const sublabel = document.createElement("span");
    sublabel.className = "sublabel";
    sublabel.textContent = entry.sublabel;
    button.appendChild(label);
    button.appendChild(sublabel);
    button.addEventListener("click", () => {
      menu.hidden = true;
      selectHandler?.(entry.id);
    });
    row.appendChild(button);
    const fields: Array<[BadgeField, boolean]> = [
      ["username", entry.hasUsername],
      ["password", entry.hasPassword],
      ["code", entry.hasTotp],
    ];
    for (const [field, available] of fields) {
      if (!available) continue;
      const fieldButton = document.createElement("button");
      fieldButton.className = "entry-field";
      fieldButton.type = "button";
      fieldButton.title = FIELD_TITLES[field];
      fieldButton.setAttribute("aria-label", `${FIELD_TITLES[field]} for ${entry.label}`);
      fieldButton.innerHTML = FIELD_ICONS[field];
      fieldButton.addEventListener("click", () => {
        menu.hidden = true;
        fieldHandler?.(entry.id, field);
      });
      row.appendChild(fieldButton);
    }
    menu.appendChild(row);
  }

  chip.addEventListener("click", () => {
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    if (willOpen) positionBadge({ host, anchor, menu });
  });

  wrap.appendChild(chip);
  wrap.appendChild(menu);
  shadow.appendChild(wrap);

  host.style.left = "-9999px";
  host.style.top = "-9999px";
  (document.documentElement ?? document.body).appendChild(host);
  positionBadge({ host, anchor, menu });
  return { host, anchor, menu };
}

export function showBadges(
  anchors: HTMLElement[],
  entries: BadgeEntry[],
  onSelect: (id: string) => void,
  onField?: (id: string, field: BadgeField) => void,
): void {
  hideBadges();
  selectHandler = onSelect;
  fieldHandler = onField ?? null;
  badges = anchors.map((anchor) => createBadge(anchor, entries));
  window.addEventListener("scroll", repositionAll, true);
  window.addEventListener("resize", repositionAll);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

export function hideBadges(): void {
  for (const badge of badges) badge.host.remove();
  badges = [];
  selectHandler = null;
  fieldHandler = null;
  window.removeEventListener("scroll", repositionAll, true);
  window.removeEventListener("resize", repositionAll);
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
}
