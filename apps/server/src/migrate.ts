import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { pool, withTransaction } from "./db.js";

const defaultMigrationsDir = path.resolve(
  fileURLToPath(new URL("../migrations", import.meta.url)),
);

const BOOTSTRAP_SQL =
  "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())";

interface MigrationRow extends QueryResultRow {
  name: string;
}

export async function runMigrations(
  migrationsDir: string = defaultMigrationsDir,
): Promise<string[]> {
  await pool.query(BOOTSTRAP_SQL);
  const appliedRows = await pool.query<MigrationRow>(
    "select name from schema_migrations",
  );
  const applied = new Set(appliedRows.rows.map((row) => row.name));
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [
        file,
      ]);
    });
    ran.push(file);
  }
  return ran;
}
