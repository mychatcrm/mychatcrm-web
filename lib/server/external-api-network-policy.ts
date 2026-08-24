import "server-only";

import { isIP } from "node:net";

function ipv4Number(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inV4Range(value: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function parseIpv6Bytes(input: string): Uint8Array | null {
  let value = input.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);

  const ipv4Tail = /(^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (ipv4Tail) {
    const ipv4 = ipv4Number(ipv4Tail[2]!);
    if (ipv4 == null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    value = `${value.slice(0, ipv4Tail.index + ipv4Tail[1]!.length)}${high}:${low}`;
  }

  if (!/^[0-9a-f:]+$/.test(value) || value.split("::").length > 2) return null;
  const [leftRaw, rightRaw] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (left.some((part) => !part || part.length > 4) || right.some((part) => !part || part.length > 4)) {
    return null;
  }
  const omitted = value.includes("::") ? 8 - left.length - right.length : 0;
  if (omitted < 0 || (!value.includes("::") && left.length !== 8)) return null;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = Number.parseInt(groups[index]!, 16);
    if (!Number.isInteger(group) || group < 0 || group > 0xffff) return null;
    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  }
  return bytes;
}

function hasPrefix(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  const remainder = bits % 8;
  if (!remainder) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (bytes[fullBytes]! & mask) === (prefix[fullBytes]! & mask);
}

export function isBlockedExternalApiIp(address: string): boolean {
  const candidate = address.trim().replace(/^\[/, "").replace(/\]$/, "");
  const kind = isIP(candidate);
  if (kind === 4) {
    const value = ipv4Number(candidate);
    if (value == null) return true;
    const ranges: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
      ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return ranges.some(([base, bits]) => inV4Range(value, ipv4Number(base)!, bits));
  }
  if (kind !== 6) return true;

  const bytes = parseIpv6Bytes(candidate);
  if (!bytes) return true;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (allZero || loopback) return true;

  const blockedPrefixes: Array<[number[], number]> = [
    [[0xfc], 7], // unique-local
    [[0xfe, 0x80], 10], // link-local
    [[0xff], 8], // multicast
    [[0x01, 0x00, 0, 0, 0, 0, 0, 0], 64], // discard-only
    [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
    [[0x20, 0x01, 0x00, 0x02, 0, 0], 48], // benchmarking
    [[0x20, 0x01, 0x00, 0x10], 28], // ORCHID
  ];
  if (blockedPrefixes.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits))) return true;

  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) {
    return isBlockedExternalApiIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  return false;
}

export function normalizedIpLiteral(hostname: string): string | null {
  const candidate = hostname.trim().replace(/^\[/, "").replace(/\]$/, "");
  return isIP(candidate) ? candidate : null;
}
