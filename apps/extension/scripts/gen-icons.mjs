import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function insideRoundedSquare(x, y, size, radius) {
  const maxX = size - 1 - radius;
  const maxY = size - 1 - radius;
  const cx = x < radius ? radius : x > maxX ? maxX : x;
  const cy = y < radius ? radius : y > maxY ? maxY : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

const CINNAMON = [0xc6, 0x8b, 0x59];
const CREAM = [0xff, 0xf8, 0xee];

function drawIcon(size) {
  const radius = Math.max(1, Math.round(size * 0.22));
  const stripeHalf = Math.max(1, size * 0.11);
  const stripeCenter = size * 1.05;
  const crumbHalf = Math.max(1, size * 0.06);
  const crumbCenter = size * 1.75;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedSquare(x, y, size, radius)) continue;
      const diag = x + y;
      const inStripe = Math.abs(diag - stripeCenter) <= stripeHalf;
      const inCrumb = Math.abs(diag - crumbCenter) <= crumbHalf;
      const [r, g, b] = inStripe || inCrumb ? CREAM : CINNAMON;
      const offset = (y * size + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(join(ROOT, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(ROOT, "icons", `${size}.png`);
  writeFileSync(file, drawIcon(size));
  process.stdout.write(`wrote ${file}\n`);
}
