/**
 * Gera `public/logo.png` (512×512, RGBA) aproximando a geometria de `logo.svg` — zlib nativo.
 * Uso: node scripts/write-brand-logo-png.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, "public", "logo.png");

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Ponto dentro de retângulo com cantos arredondados (eixo alinhado). */
function inRoundRect(px, py, x, y, w, h, rx) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  rx = Math.min(rx, w / 2, h / 2);
  const ax = px - x;
  const ay = py - y;
  if (ax < rx && ay < rx) return (ax - rx) ** 2 + (ay - rx) ** 2 <= rx ** 2;
  if (ax > w - rx && ay < rx) return (ax - (w - rx)) ** 2 + (ay - rx) ** 2 <= rx ** 2;
  if (ax < rx && ay > h - rx) return (ax - rx) ** 2 + (ay - (h - rx)) ** 2 <= rx ** 2;
  if (ax > w - rx && ay > h - rx) return (ax - (w - rx)) ** 2 + (ay - (h - rx)) ** 2 <= rx ** 2;
  return true;
}

function inBar(px, py, x1, y1, x2, y2, halfW) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / len;
  const dy = (y2 - y1) / len;
  const nx = -dy;
  const ny = dx;
  const vx = px - cx;
  const vy = py - cy;
  const along = vx * dx + vy * dy;
  const across = Math.abs(vx * nx + vy * ny);
  return Math.abs(along) <= len / 2 + 1 && across <= halfW;
}

const W = 512;
const H = 512;
const s = W / 120;
const rx = 26 * s,
  ry = 26 * s,
  rw = 68 * s,
  rh = 68 * s,
  rrx = 18 * s;

const bpp = 4;
const row = 1 + W * bpp;
const raw = Buffer.alloc(row * H);

const OR = 0xf2,
  OG = 0x44,
  OB = 0x00,
  OA = 0xff;
const WR = 0xff,
  WG = 0xfc,
  WB = 0xf9,
  WA = 0xff;
const BR = 0xff,
  BG = 0xff,
  BB = 0xff,
  BA = 0xff;

for (let py = 0; py < H; py++) {
  const o = py * row;
  raw[o] = 0;
  for (let px = 0; px < W; px++) {
    const i = o + 1 + px * bpp;
    let r = BR,
      g = BG,
      b = BB,
      a = BA;
    if (inRoundRect(px, py, rx, ry, rw, rh, rrx)) {
      const lw = (7 * s) / 2;
      const x0 = 42 * s,
        y1 = 52 * s,
        x1 = 78 * s;
      const x0b = 42 * s,
        y2 = 68 * s,
        x1b = 70 * s;
      if (inBar(px, py, x0, y1, x1, y1, lw) || inBar(px, py, x0b, y2, x1b, y2, lw)) {
        r = WR;
        g = WG;
        b = WB;
        a = WA;
      } else {
        r = OR;
        g = OG;
        b = OB;
        a = OA;
      }
    }
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = a;
  }
}

const idat = zlib.deflateSync(raw, { level: 9 });
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync(outPath, png);
console.log("Wrote", outPath, png.length, "bytes");
