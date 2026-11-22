interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

interface RawAndroidBridge {
  save(items: string): void;
  clear(): void;
}

interface RawIosBridge {
  postMessage(message: unknown): void;
}

export function isNativeApp(): boolean {
  return capacitor() !== null || rawBridge() !== null;
}

function capacitor(): CapacitorGlobal | null {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap ?? null;
}

function rawBridge(): RawAndroidBridge | null {
  const bridge = (window as unknown as { ToastyBridge?: RawAndroidBridge }).ToastyBridge;
  return bridge ?? null;
}

function iosBridge(): RawIosBridge | null {
  const webkit = (window as unknown as {
    webkit?: { messageHandlers?: { VaultCache?: RawIosBridge } };
  }).webkit;
  return webkit?.messageHandlers?.VaultCache ?? null;
}

export interface NativeCredential {
  id: string;
  name: string;
  username: string;
  password: string;
  urls: string[];
}

export interface VaultCachePlugin {
  save(options: { items: string }): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Returns the native credential-cache plugin, or null when running in a
 * plain web browser (no cache is kept there — web autofill is the
 * extension's job).
 */
export function vaultCache(): VaultCachePlugin | null {
  const android = rawBridge();
  if (android !== null) {
    return {
      save: (options) => {
        android.save(options.items);
        return Promise.resolve();
      },
      clear: () => {
        android.clear();
        return Promise.resolve();
      },
    };
  }
  const ios = iosBridge();
  if (ios !== null) {
    return {
      save: (options) => {
        ios.postMessage({ action: "save", items: options.items });
        return Promise.resolve();
      },
      clear: () => {
        ios.postMessage({ action: "clear" });
        return Promise.resolve();
      },
    };
  }
  return null;
}
