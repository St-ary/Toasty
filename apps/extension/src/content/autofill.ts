import type { Credentials } from "../lib/types";
import type { DetectedForm } from "./forms";

function setNativeValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export interface FillSelection {
  username?: string;
  password?: string;
}

export function fillFields(detected: DetectedForm, selection: FillSelection): void {
  if (selection.username !== undefined && selection.username && detected.usernameField) {
    setNativeValue(detected.usernameField, selection.username);
  }
  if (selection.password !== undefined && selection.password) {
    setNativeValue(detected.passwordField, selection.password);
  }
}

export function fillCredentials(detected: DetectedForm, credentials: Credentials): void {
  if (detected.usernameField && credentials.username) {
    setNativeValue(detected.usernameField, credentials.username);
  }
  setNativeValue(detected.passwordField, credentials.password);
}

export function fillCode(detected: DetectedForm, code: string): boolean {
  if (!detected.otpField || code.length === 0) return false;
  setNativeValue(detected.otpField, code);
  return true;
}
