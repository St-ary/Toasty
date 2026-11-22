import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { clientIp } from "./rate-limit.js";

export type ErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_taken"
  | "registration_closed"
  | "invalid_setup_token"
  | "unauthorized"
  | "session_expired"
  | "not_found"
  | "rate_limited"
  | "internal";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

interface FilePayload {
  filePath: string;
  contentType: string;
  size: number;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  file?: FilePayload;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  ip: string;
}

export type Handler = (ctx: RequestContext) => Promise<Reply> | Reply;

export interface RouterOptions {
  corsOrigins: string[] | "*";
  staticDir?: string | null;
  trustProxy?: boolean;
  log?: (line: string) => void;
}

export interface Router {
  route(method: string, pattern: string, handler: Handler): void;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function ok(body: unknown): Reply {
  return { status: 200, body };
}

export function created(body: unknown): Reply {
  return { status: 201, body };
}

export function noContent(): Reply {
  return { status: 204 };
}

export function errorReply(error: HttpError): Reply {
  return {
    status: error.status,
    body: { error: { code: error.code, message: error.message } },
  };
}

type PatternSegment =
  | { kind: "literal"; value: string }
  | { kind: "param"; name: string };

interface RouteEntry {
  method: string;
  segments: PatternSegment[];
  handler: Handler;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function compilePattern(pattern: string): PatternSegment[] {
  return splitPath(pattern).map((segment) =>
    segment.startsWith(":")
      ? { kind: "param", name: segment.slice(1) }
      : { kind: "literal", value: segment },
  );
}

function matchSegments(
  pattern: PatternSegment[],
  segments: string[],
): Record<string, string> | null {
  if (pattern.length !== segments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const part = pattern[i];
    const value = segments[i];
    if (part.kind === "param") {
      params[part.name] = value;
    } else if (part.value !== value) {
      return null;
    }
  }
  return params;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"];
  const mediaType = (Array.isArray(contentType) ? contentType[0] : contentType)
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const declared = Number(req.headers["content-length"] ?? 0);
  if (mediaType !== undefined && mediaType !== "application/json") {
    throw new HttpError(
      400,
      "invalid_request",
      "Content-Type must be application/json",
    );
  }
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(400, "invalid_request", "Request body exceeds 1 MB");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(400, "invalid_request", "Request body exceeds 1 MB");
    }
    chunks.push(chunk);
  }
  if (total === 0) {
    return undefined;
  }
  if (mediaType !== "application/json") {
    throw new HttpError(
      400,
      "invalid_request",
      "Content-Type must be application/json",
    );
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_request", "Request body must be valid JSON");
  }
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function statFile(filePath: string): Promise<FilePayload | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return {
      filePath,
      contentType: contentTypeFor(filePath),
      size: stats.size,
    };
  } catch {
    return null;
  }
}

function fileReply(file: FilePayload, cacheControl: string): Reply {
  return {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": cacheControl,
    },
    file,
  };
}

async function staticReply(root: string, pathname: string): Promise<Reply> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "invalid_request", "Malformed request path");
  }
  const target = path.resolve(root, decoded.replace(/^\/+/, ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new HttpError(400, "invalid_request", "Malformed request path");
  }
  const immutable = /^\/?assets\/.+/.test(decoded) && !decoded.endsWith(".html");
  const cacheControl = immutable ? "public, max-age=31536000, immutable" : "no-cache";
  const file = await statFile(target);
  if (file !== null) {
    return fileReply(file, cacheControl);
  }
  const indexFile = await statFile(path.join(root, "index.html"));
  if (indexFile !== null) {
    return fileReply(indexFile, "no-cache");
  }
  throw new HttpError(404, "not_found", "Not found");
}

function writeReply(res: ServerResponse, reply: Reply, method: string): void {
  if (reply.headers !== undefined) {
    for (const [name, value] of Object.entries(reply.headers)) {
      res.setHeader(name, value);
    }
  }
  if (reply.file !== undefined) {
    res.writeHead(reply.status);
    if (method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(reply.file.filePath).pipe(res);
    return;
  }
  if (reply.body === undefined || reply.status === 204) {
    res.writeHead(reply.status);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(payload)));
  res.writeHead(reply.status);
  res.end(payload);
}

function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  corsOrigins: string[] | "*",
): void {
  const origin = req.headers.origin;
  if (typeof origin !== "string") {
    return;
  }
  const allowAll = corsOrigins === "*";
  const allowed = allowAll || corsOrigins.includes(origin);
  if (!allowed) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
  res.setHeader("Vary", "Origin");
}

export function createRouter(options: RouterOptions): Router {
  const routes: RouteEntry[] = [];
  const staticRoot =
    options.staticDir === undefined || options.staticDir === null
      ? null
      : path.resolve(options.staticDir);
  const trustProxy = options.trustProxy ?? false;
  const log = options.log ?? ((line: string) => console.log(line));

  const dispatch = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
    query: URLSearchParams,
    ip: string,
  ): Promise<Reply> => {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const segments = splitPath(pathname);
      for (const route of routes) {
        if (route.method !== method) {
          continue;
        }
        const params = matchSegments(route.segments, segments);
        if (params === null) {
          continue;
        }
        const body = BODY_METHODS.has(method)
          ? await readJsonBody(req)
          : undefined;
        return await route.handler({ req, res, params, query, body, ip });
      }
      throw new HttpError(404, "not_found", "No such endpoint");
    }
    if (staticRoot !== null && (method === "GET" || method === "HEAD")) {
      return await staticReply(staticRoot, pathname);
    }
    throw new HttpError(404, "not_found", "Not found");
  };

  return {
    route(method: string, pattern: string, handler: Handler): void {
      routes.push({
        method: method.toUpperCase(),
        segments: compilePattern(pattern),
        handler,
      });
    },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = (req.method ?? "GET").toUpperCase();
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      let status = 500;
      try {
        applyCors(req, res, options.corsOrigins);
        if (method === "OPTIONS" && req.headers.origin !== undefined) {
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
          res.setHeader("Access-Control-Max-Age", "600");
          status = 204;
          res.writeHead(204);
          res.end();
          return;
        }
        const reply = await dispatch(
          req,
          res,
          method,
          pathname,
          url.searchParams,
          clientIp(req, trustProxy),
        );
        status = reply.status;
        writeReply(res, reply, method);
      } catch (error) {
        const httpError =
          error instanceof HttpError
            ? error
            : new HttpError(500, "internal", "Internal server error");
        status = httpError.status;
        writeReply(res, errorReply(httpError), method);
      } finally {
        log(`${method} ${pathname} ${status}`);
      }
    },
  };
}
