import { ok } from "../lib/http.js";
import type { Router } from "../lib/http.js";

export function registerHealthRoutes(router: Router): void {
  router.route("GET", "/api/health", () =>
    ok({ ok: true, serverTime: new Date().toISOString() }),
  );
}
