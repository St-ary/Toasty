// Toasty updater service (opt-in sidecar).
//
// Runs as `node dist/updater.js` with the Docker socket mounted. The app asks it
// to switch versions; it pulls the requested image and swaps the target
// container using the Docker Engine API over the unix socket. The previous
// container is kept under a backup name until the new one has started, so a
// failed swap rolls back instead of leaving the instance down.
//
// Environment:
//   DOCKER_SOCKET   (default /var/run/docker.sock)
//   TARGET_CONTAINER (default toasty-app)
//   UPDATER_PORT    (default 8090)

import { createServer, request as httpRequest, type IncomingMessage } from "node:http";

const SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const TARGET = process.env.TARGET_CONTAINER ?? "toasty-app";
const PORT = Number(process.env.UPDATER_PORT ?? "8090");
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._\-/]*(:[a-z0-9][a-z0-9._\-]{0,63})?$/i;

function log(line: string): void {
  console.log(`[updater] ${new Date().toISOString()} ${line}`);
}

interface DockerReply {
  status: number;
  raw: string;
  json: unknown;
}

function docker(method: string, path: string, payload?: unknown): Promise<DockerReply> {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = httpRequest(
      {
        socketPath: SOCKET,
        method,
        path,
        headers:
          body === null
            ? {}
            : { "content-type": "application/json", "content-length": String(body.length) },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, raw, json });
        });
      },
    );
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function pullImage(image: string): Promise<void> {
  const separator = image.lastIndexOf(":");
  const hasTag = separator > image.lastIndexOf("/");
  const fromImage = hasTag ? image.slice(0, separator) : image;
  const tag = hasTag ? image.slice(separator + 1) : "latest";
  const path = `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`;
  log(`pulling ${image}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { socketPath: SOCKET, method: "POST", path, headers: { "content-type": "application/json" } },
      (res: IncomingMessage) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim().length === 0) continue;
            try {
              const parsed = JSON.parse(line) as { error?: string; errorDetail?: { message?: string } };
              if (parsed.error !== undefined) {
                reject(new Error(parsed.errorDetail?.message ?? parsed.error));
                req.destroy();
                return;
              }
            } catch {
              // progress line without JSON; ignore
            }
          }
        });
        res.on("end", () => {
          log(`pulled ${image}`);
          resolve();
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write("{}");
    req.end();
  });
}

function buildCreateBody(info: Record<string, any>, image: string): Record<string, unknown> {
  const cfg = (info.Config ?? {}) as Record<string, any>;
  const hc = (info.HostConfig ?? {}) as Record<string, any>;
  const binds: string[] = [];
  for (const mount of (info.Mounts ?? []) as Array<Record<string, any>>) {
    const mode = mount.RW === false ? ":ro" : "";
    if (mount.Type === "bind" && typeof mount.Source === "string") {
      binds.push(`${mount.Source}:${mount.Destination}${mode}`);
    } else if (mount.Type === "volume" && typeof mount.Name === "string") {
      binds.push(`${mount.Name}:${mount.Destination}${mode}`);
    }
  }
  const endpoints: Record<string, unknown> = {};
  for (const [name, rawEndpoint] of Object.entries(
    (info.NetworkSettings?.Networks ?? {}) as Record<string, any>,
  )) {
    endpoints[name] = {
      Aliases: rawEndpoint.Aliases ?? [],
      Links: rawEndpoint.Links ?? [],
      DriverOpts: rawEndpoint.DriverOpts ?? {},
      ...(rawEndpoint.IPAMConfig ? { IPAMConfig: rawEndpoint.IPAMConfig } : {}),
    };
  }
  return {
    Image: image,
    Hostname: cfg.Hostname,
    Domainname: cfg.Domainname,
    User: cfg.User,
    WorkingDir: cfg.WorkingDir,
    Env: cfg.Env,
    Cmd: cfg.Cmd,
    Entrypoint: cfg.Entrypoint,
    Labels: cfg.Labels,
    ExposedPorts: cfg.ExposedPorts,
    Tty: cfg.Tty === true,
    OpenStdin: cfg.OpenStdin === true,
    HostConfig: {
      Binds: binds.length > 0 ? binds : (hc.Binds ?? null),
      PortBindings: hc.PortBindings ?? null,
      NetworkMode: hc.NetworkMode ?? "default",
      RestartPolicy: hc.RestartPolicy ?? { Name: "no", MaximumRetryCount: 0 },
      LogConfig: {
        Type: hc.LogConfig?.Type ?? "json-file",
        Config: hc.LogConfig?.Config ?? {},
      },
      ExtraHosts: hc.ExtraHosts ?? null,
      CapAdd: hc.CapAdd ?? null,
      CapDrop: hc.CapDrop ?? null,
      Privileged: hc.Privileged === true,
      ReadonlyRootfs: hc.ReadonlyRootfs === true,
      Dns: hc.Dns ?? null,
      DnsSearch: hc.DnsSearch ?? null,
      Sysctls: hc.Sysctls ?? null,
      Memory: hc.Memory ?? 0,
      NanoCpus: hc.NanoCpus ?? 0,
      Init: hc.Init === true,
    },
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

async function rename(from: string, to: string): Promise<void> {
  await docker("POST", `/containers/${encodeURIComponent(from)}/rename?name=${encodeURIComponent(to)}`);
}

async function applyUpdate(image: string): Promise<void> {
  const inspect = await docker("GET", `/containers/${encodeURIComponent(TARGET)}/json`);
  if (inspect.status !== 200) {
    throw new Error(`container ${TARGET} not found (${inspect.status})`);
  }
  const info = inspect.json as Record<string, any>;
  try {
    await pullImage(image);
  } catch (error) {
    const local = await docker("GET", `/images/${encodeURIComponent(image)}/json`);
    if (local.status !== 200) throw error;
    log(`pull unavailable, using the local image ${image}`);
  }

  const backup = `${TARGET}-prev`;
  await docker("DELETE", `/containers/${encodeURIComponent(backup)}?force=true&v=false`);
  await docker("POST", `/containers/${encodeURIComponent(TARGET)}/stop?t=15`);
  await rename(TARGET, backup);
  try {
    const created = await docker("POST", "/containers/create?name=" + encodeURIComponent(TARGET), buildCreateBody(info, image));
    if (created.status !== 201) {
      throw new Error(`create failed (${created.status}): ${created.raw}`);
    }
    const id = (created.json as { Id: string }).Id;
    const started = await docker("POST", `/containers/${encodeURIComponent(id)}/start`);
    if (started.status !== 204 && started.status !== 304) {
      throw new Error(`start failed (${started.status}): ${started.raw}`);
    }
    await docker("DELETE", `/containers/${encodeURIComponent(backup)}?force=true&v=false`);
    log(`switched ${TARGET} to ${image}`);
  } catch (error) {
    log(`swap failed, rolling back: ${error instanceof Error ? error.message : String(error)}`);
    await docker("DELETE", `/containers/${encodeURIComponent(TARGET)}?force=true&v=false`);
    await rename(backup, TARGET);
    const restarted = await docker("POST", `/containers/${encodeURIComponent(TARGET)}/start`);
    log(`rollback finished (${restarted.status})`);
    throw error;
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, target: TARGET, socket: SOCKET }));
      return;
    }
    if (req.method === "POST" && url === "/apply") {
      const body = (await readBody(req)) as { image?: unknown } | null;
      const image = typeof body?.image === "string" ? body.image.trim() : "";
      if (image.length === 0 || image.length > 200 || !IMAGE_PATTERN.test(image)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid image reference" }));
        return;
      }
      log(`apply requested: ${image} for ${TARGET}`);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true, image, target: TARGET }));
      // Swap after the response has been flushed; the app container is about to
      // be replaced, so nothing more can be reported over this connection.
      setTimeout(() => {
        applyUpdate(image).catch((error: unknown) =>
          log(`apply failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      }, 1500);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  })();
});

server.listen(PORT, "0.0.0.0", () => {
  log(`updater listening on :${PORT}, target container ${TARGET}`);
});
