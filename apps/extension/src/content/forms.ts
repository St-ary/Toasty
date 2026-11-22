export type FormKind = "login" | "register" | "change";

export interface DetectedForm {
  form: HTMLFormElement | null;
  container: HTMLElement;
  kind: FormKind;
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
  newPasswordField: HTMLInputElement | null;
  confirmField: HTMLInputElement | null;
  otpField: HTMLInputElement | null;
}

const USERNAME_HINT = /(user|login|sign.?in|email|e-?mail|account|identifier)/i;
const OTP_HINT = /(otp|totp|one.?time|2fa|two.?factor|verification|auth(enticator)?)/i;

export function isVisible(element: HTMLElement): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("type") === "hidden") return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isUsernameCandidate(input: HTMLInputElement): boolean {
  if (!isVisible(input) || input.disabled || input.readOnly) return false;
  const type = input.type.toLowerCase();
  return type === "text" || type === "email" || type === "tel" || type === "";
}

function usernameScore(input: HTMLInputElement): number {
  let score = 0;
  const autocomplete = (input.autocomplete ?? "").toLowerCase();
  if (autocomplete === "username" || autocomplete === "email") score += 100;
  if (input.type.toLowerCase() === "email") score += 30;
  const haystack = [input.name, input.id, input.placeholder, input.getAttribute("aria-label") ?? ""]
    .join(" ")
    .toLowerCase();
  if (USERNAME_HINT.test(haystack)) score += 50;
  return score;
}

function findUsernameField(scope: ParentNode, passwordField: HTMLInputElement): HTMLInputElement | null {
  const candidates = Array.from(scope.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) => input !== passwordField && isUsernameCandidate(input) && usernameScore(input) > 0,
  );
  if (candidates.length === 0) return null;
  const preceding = candidates.filter(
    (input) => (passwordField.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  const pool = preceding.length > 0 ? preceding : candidates;
  pool.sort((a, b) => usernameScore(b) - usernameScore(a));
  return pool[0] ?? null;
}

function passwordInputs(scope: ParentNode): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(
    (input) => isVisible(input) && !input.disabled,
  );
}

function findOtpField(scope: ParentNode, exclude: Array<HTMLInputElement | null>): HTMLInputElement | null {
  const excluded = new Set(exclude.filter((input): input is HTMLInputElement => input !== null));
  const candidates = Array.from(scope.querySelectorAll<HTMLInputElement>("input")).filter((input) => {
    if (excluded.has(input) || !isVisible(input) || input.disabled || input.readOnly) return false;
    const type = input.type.toLowerCase();
    if (type !== "text" && type !== "tel" && type !== "number" && type !== "") return false;
    if ((input.autocomplete ?? "").toLowerCase() === "one-time-code") return true;
    const haystack = [input.name, input.id, input.placeholder, input.getAttribute("aria-label") ?? ""]
      .join(" ")
      .toLowerCase();
    return OTP_HINT.test(haystack);
  });
  candidates.sort((a, b) => {
    const autoA = (a.autocomplete ?? "").toLowerCase() === "one-time-code" ? 1 : 0;
    const autoB = (b.autocomplete ?? "").toLowerCase() === "one-time-code" ? 1 : 0;
    return autoB - autoA;
  });
  return candidates[0] ?? null;
}

function describeGroup(
  form: HTMLFormElement | null,
  container: HTMLElement,
  passwords: HTMLInputElement[],
): DetectedForm | null {
  if (passwords.length === 0) return null;
  const kind: FormKind = passwords.length >= 3 ? "change" : passwords.length === 2 ? "register" : "login";
  const primary = passwords[0];
  if (!primary) return null;
  const usernameField = findUsernameField(container, primary);
  const newPasswordField = kind === "change" ? passwords[1] ?? null : null;
  const confirmField = passwords.length >= 3 ? passwords[2] ?? null : null;
  return {
    form,
    container,
    kind,
    usernameField,
    passwordField: primary,
    newPasswordField,
    confirmField,
    otpField: findOtpField(container, [usernameField, primary, newPasswordField, confirmField]),
  };
}

export function describeForm(form: HTMLFormElement): DetectedForm | null {
  return describeGroup(form, form, passwordInputs(form));
}

export function detectForms(): DetectedForm[] {
  const groups = new Map<HTMLElement, HTMLInputElement[]>();
  for (const input of passwordInputs(document)) {
    const container = input.form ?? input.parentElement ?? document.body;
    const list = groups.get(container) ?? [];
    list.push(input);
    groups.set(container, list);
  }
  const forms: DetectedForm[] = [];
  for (const [container, passwords] of groups) {
    const detected = describeGroup(
      container instanceof HTMLFormElement ? container : null,
      container,
      passwords,
    );
    if (detected) forms.push(detected);
  }
  return forms;
}
