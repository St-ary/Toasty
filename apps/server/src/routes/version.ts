import type { Config } from "../config.js";
import { HttpError, ok, type RequestContext, type Router } from "../lib/http.js";
import {
  compareVersions,
  currentVersion,
  loadManifest,
  resolveImageRef,
  versionStatus,
} from "../lib/version.js";
import { requireAuth } from "./auth.js";

const MANUAL_COMMAND = "docker compose pull && docker compose up -d";

export function registerVersionRoutes(router: Router, config: Config): void {
  router.route("GET", "/api/version", async () => {
    const status = await versionStatus({
      manifestUrl: config.updateManifestUrl,
      checkEnabled: config.updateCheck,
    });
    return ok({ ...status, updaterAvailable: config.updaterUrl !== null });
  });

  router.route("POST", "/api/version/apply", async (ctx: RequestContext) => {
    await requireAuth(ctx);
    const body = ctx.body as { version?: unknown } | undefined;
    const version = body?.version;
    if (typeof version !== "string" || version.trim().length === 0) {
      throw new HttpError(400, "invalid_request", "A version is required");
    }
    const target = version.trim();
    const { manifest } = await loadManifest({
      manifestUrl: config.updateManifestUrl,
      checkEnabled: config.updateCheck,
    });
    const entry = manifest?.versions.find((candidate) => candidate.version === target);
    if (entry === undefined) {
      throw new HttpError(404, "not_found", `Version ${target} is not in the release channel`);
    }
    const current = await currentVersion();
    const direction = compareVersions(target, current);
    const action = direction > 0 ? "update" : direction < 0 ? "downgrade" : "reinstall";

    if (config.updaterUrl === null) {
      return ok({
        mode: "manual",
        action,
        version: target,
        command: MANUAL_COMMAND,
        message: "No updater service is attached. Run the command on the server to switch versions.",
      });
    }

    const image = resolveImageRef(entry, config.updateImageRepo);
    try {
      const response = await fetch(new URL("/apply", config.updaterUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image, version: target }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`updater replied ${response.status}`);
      }
    } catch (error) {
      throw new HttpError(
        502,
        "internal",
        `The updater service did not accept the ${action} (${error instanceof Error ? error.message : "unknown error"})`,
      );
    }
    return ok({
      mode: "updater",
      action,
      version: target,
      image,
      message: "The instance is switching versions now. It will be back in a moment.",
    });
  });
}
