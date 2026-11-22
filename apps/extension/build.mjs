import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entries = [
  { name: "background", src: join(root, "src/background.ts"), format: "esm" },
  { name: "content", src: join(root, "src/content/index.ts"), format: "iife" },
  { name: "webauthn-inject", src: join(root, "src/content/webauthn-inject.ts"), format: "iife" },
  { name: "popup", src: join(root, "src/popup/popup.tsx"), format: "esm" },
  { name: "options", src: join(root, "src/options/options.tsx"), format: "esm" },
];

for (const entry of entries) {
  await build({
    entryPoints: { [entry.name]: entry.src },
    outdir,
    bundle: true,
    format: entry.format,
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });
}

const staticFiles = [
  join(root, "manifest.json"),
  join(root, "src/popup/popup.html"),
  join(root, "src/popup/popup.css"),
  join(root, "src/options/options.html"),
  join(root, "src/options/options.css"),
];

for (const file of staticFiles) {
  await cp(file, join(outdir, file.split("/").pop()));
}

await cp(join(root, "icons"), join(outdir, "icons"), { recursive: true });
