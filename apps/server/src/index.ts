import { createServer } from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { pool, query } from "./db.js";
import { countUsers, ensureSetupToken } from "./lib/app-settings.js";
import { createRouter } from "./lib/http.js";
import { runMigrations } from "./migrate.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerVaultRoutes } from "./routes/vault.js";
import { registerVersionRoutes } from "./routes/version.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.migrateOnBoot) {
    await runMigrations();
  }

  await query("delete from sessions where expires_at < now()");

  if ((await countUsers()) === 0 && !config.allowRegistration) {
    const setupToken = await ensureSetupToken();
    console.log(`toasty first-run setup required — setup token: ${setupToken}`);
  }

  const router = createRouter({
    corsOrigins: config.corsOrigins,
    staticDir:
      config.staticDir === null ? null : path.resolve(config.staticDir),
    trustProxy: config.trustProxy,
  });
  registerHealthRoutes(router);
  registerAuthRoutes(router, config);
  registerVaultRoutes(router);
  registerVersionRoutes(router, config);

  const server = createServer((req, res) => {
    void router.handle(req, res);
  });

  server.listen(config.port, config.host, () => {
    console.log(`toasty server listening on http://${config.host}:${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
