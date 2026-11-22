import { withTransaction, query } from "../db.js";
import { HttpError, noContent, ok } from "../lib/http.js";
import type { Handler, Reply, RequestContext, Router } from "../lib/http.js";
import { RateLimiter } from "../lib/rate-limit.js";
import { requireAuth } from "./auth.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_TYPE_PATTERN = /^[a-z0-9_-]{1,32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_IV_BYTES = 32;
const MAX_BATCH_ITEMS = 500;
const MAX_ITEMS_PER_USER = 10000;
const LIST_LIMIT = 1000;

interface ItemRow {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updated_at: Date;
}

interface ItemInput {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
}

interface ClientItem {
  id: string;
  type: string;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

const UPSERT_ITEM_SQL = `
  insert into vault_items (id, user_id, type, ciphertext, iv, deleted)
  values ($1, $2, $3, $4, $5, $6)
  on conflict (user_id, id) do update
    set type = excluded.type,
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        deleted = excluded.deleted,
        updated_at = now()
  returning id, type, ciphertext, iv, deleted, updated_at`;

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body must be a JSON object",
    );
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "invalid_request", `${field} must be a non-empty string`);
  }
  return value;
}

function decodeBase64Url(text: string, field: string, maxBytes: number): Buffer {
  if (!BASE64URL_PATTERN.test(text)) {
    throw new HttpError(400, "invalid_request", `${field} must be base64url`);
  }
  const decoded = Buffer.from(text, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== text) {
    throw new HttpError(400, "invalid_request", `${field} must be canonical base64url`);
  }
  if (decoded.length > maxBytes) {
    throw new HttpError(400, "invalid_request", `${field} is too large`);
  }
  return decoded;
}

function validateItemId(value: unknown): string {
  const id = requireString(value, "id");
  if (!UUID_PATTERN.test(id)) {
    throw new HttpError(400, "invalid_request", "id must be a UUID");
  }
  return id.toLowerCase();
}

function validateItemFields(
  body: Record<string, unknown>,
  includeId: boolean,
): ItemInput {
  const id = includeId ? validateItemId(body.id) : "";
  const type = requireString(body.type, "type");
  if (!ITEM_TYPE_PATTERN.test(type)) {
    throw new HttpError(
      400,
      "invalid_request",
      "type must be 1-32 characters of [a-z0-9_-]",
    );
  }
  const ciphertext = requireString(body.ciphertext, "ciphertext");
  decodeBase64Url(ciphertext, "ciphertext", MAX_CIPHERTEXT_BYTES);
  const iv = requireString(body.iv, "iv");
  decodeBase64Url(iv, "iv", MAX_IV_BYTES);
  const deleted = body.deleted ?? false;
  if (typeof deleted !== "boolean") {
    throw new HttpError(400, "invalid_request", "deleted must be a boolean");
  }
  return { id, type, ciphertext, iv, deleted };
}

function toClientItem(row: ItemRow): ClientItem {
  return {
    id: row.id,
    type: row.type,
    ciphertext: row.ciphertext,
    iv: row.iv,
    deleted: row.deleted,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function countLiveItems(
  userId: string,
): Promise<number> {
  const rows = await query<{ count: string }>(
    "select count(*) as count from vault_items where user_id = $1 and deleted = false",
    [userId],
  );
  return Number(rows[0].count);
}

async function handleListItems(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const since = ctx.query.get("since");
  if (since !== null) {
    if (!ISO_TIMESTAMP_PATTERN.test(since) || Number.isNaN(Date.parse(since))) {
      throw new HttpError(400, "invalid_request", "since must be an ISO-8601 timestamp");
    }
    const rows = await query<ItemRow>(
      `select id, type, ciphertext, iv, deleted, updated_at
       from vault_items
       where user_id = $1 and updated_at > $2
       order by updated_at asc
       limit ${LIST_LIMIT}`,
      [auth.userId, since],
    );
    return ok({
      items: rows.map(toClientItem),
      serverTime: new Date().toISOString(),
    });
  }
  const rows = await query<ItemRow>(
    `select id, type, ciphertext, iv, deleted, updated_at
     from vault_items
     where user_id = $1
     order by updated_at asc
     limit ${LIST_LIMIT}`,
    [auth.userId],
  );
  return ok({
    items: rows.map(toClientItem),
    serverTime: new Date().toISOString(),
  });
}

async function handleUpsertItem(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const id = validateItemId(ctx.params.id);
  const item = validateItemFields(asObject(ctx.body), false);
  const stored = await withTransaction(async (client) => {
    const existing = await client.query(
      "select 1 from vault_items where user_id = $1 and id = $2",
      [auth.userId, id],
    );
    if ((existing.rowCount ?? 0) === 0) {
      const countRows = await client.query<{ count: string }>(
        "select count(*) as count from vault_items where user_id = $1 and deleted = false",
        [auth.userId],
      );
      if (Number(countRows.rows[0].count) >= MAX_ITEMS_PER_USER) {
        throw new HttpError(
          400,
          "invalid_request",
          "A user can hold at most 10000 vault items",
        );
      }
    }
    const upserted = await client.query<ItemRow>(UPSERT_ITEM_SQL, [
      id,
      auth.userId,
      item.type,
      item.ciphertext,
      item.iv,
      item.deleted,
    ]);
    return upserted.rows[0];
  });
  return ok(toClientItem(stored));
}

async function handleBatchUpsert(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const body = asObject(ctx.body);
  const rawItems = body.items;
  if (!Array.isArray(rawItems)) {
    throw new HttpError(400, "invalid_request", "items must be an array");
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    throw new HttpError(
      400,
      "invalid_request",
      "items must contain at most 500 entries",
    );
  }
  const items = rawItems.map((entry) => validateItemFields(asObject(entry), true));
  const stored = await withTransaction(async (client) => {
    const ids = items.map((item) => item.id);
    const existing = await client.query<{ id: string }>(
      "select id from vault_items where user_id = $1 and id = any($2::uuid[])",
      [auth.userId, ids],
    );
    const existingIds = new Set(existing.rows.map((row) => row.id));
    const newItemIds = new Set(
      items.filter((item) => !existingIds.has(item.id)).map((item) => item.id),
    );
    const countRows = await client.query<{ count: string }>(
      "select count(*) as count from vault_items where user_id = $1 and deleted = false",
      [auth.userId],
    );
    if (Number(countRows.rows[0].count) + newItemIds.size > MAX_ITEMS_PER_USER) {
      throw new HttpError(
        400,
        "invalid_request",
        "A user can hold at most 10000 vault items",
      );
    }
    const results: ItemRow[] = [];
    for (const item of items) {
      const upserted = await client.query<ItemRow>(UPSERT_ITEM_SQL, [
        item.id,
        auth.userId,
        item.type,
        item.ciphertext,
        item.iv,
        item.deleted,
      ]);
      results.push(upserted.rows[0]);
    }
    return results;
  });
  return ok({
    items: stored.map(toClientItem),
    serverTime: new Date().toISOString(),
  });
}

async function handleDeleteItem(ctx: RequestContext): Promise<Reply> {
  const auth = await requireAuth(ctx);
  const id = validateItemId(ctx.params.id);
  const rows = await query<{ id: string }>(
    `update vault_items set deleted = true, updated_at = now()
     where user_id = $1 and id = $2
     returning id`,
    [auth.userId, id],
  );
  if (rows.length === 0) {
    throw new HttpError(404, "not_found", "Item not found");
  }
  return noContent();
}

export function registerVaultRoutes(router: Router): void {
  const limiter = new RateLimiter(240, 60_000);
  const rateLimit =
    (handler: Handler): Handler =>
    async (ctx) => {
      if (!limiter.check(ctx.ip)) {
        throw new HttpError(429, "rate_limited", "Too many requests, please slow down");
      }
      return handler(ctx);
    };
  router.route("GET", "/api/vault/items", rateLimit((ctx) => handleListItems(ctx)));
  router.route("POST", "/api/vault/items/batch", rateLimit((ctx) => handleBatchUpsert(ctx)));
  router.route("PUT", "/api/vault/items/:id", rateLimit((ctx) => handleUpsertItem(ctx)));
  router.route("DELETE", "/api/vault/items/:id", rateLimit((ctx) => handleDeleteItem(ctx)));
}
