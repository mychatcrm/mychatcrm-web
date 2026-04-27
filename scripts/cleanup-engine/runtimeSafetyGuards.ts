import path from "node:path";
import type { CleanupEngineConfig } from "./types";

/** Ficheiros especiais na árvore `app/` do Next (convenção). */
const NEXT_APP_ENTRY_BASENAMES = new Set([
  "favicon.ico",
  "robots.ts",
  "robots.js",
  "sitemap.ts",
  "sitemap.js",
  "manifest.ts",
  "manifest.js",
  "opengraph-image.tsx",
  "opengraph-image.ts",
  "twitter-image.tsx",
  "twitter-image.ts",
  "icon.tsx",
  "icon.ts",
  "apple-icon.tsx",
  "apple-icon.ts",
]);

export function isNextAppConventionFile(relPosix: string): boolean {
  if (!relPosix.startsWith("app/")) return false;
  const base = path.posix.basename(relPosix);
  if (NEXT_APP_ENTRY_BASENAMES.has(base)) return true;
  if (/^icon-\d+\.png$/i.test(base)) return true;
  if (/^apple-icon-\d+\.png$/i.test(base)) return true;
  return false;
}

export function isProtectedPublicBasename(basename: string, config: CleanupEngineConfig): boolean {
  const lower = basename.toLowerCase();
  if (lower === "robots.txt") return true;
  if (/^sitemap.*\.xml$/i.test(basename)) return true;
  for (const p of config.protectedPublicBasenames) {
    if (lower === p.toLowerCase()) return true;
  }
  return false;
}

export function isProtectedPath(relPosix: string, config: CleanupEngineConfig): boolean {
  const lower = relPosix.toLowerCase();
  for (const sub of config.protectedPathSubstrings) {
    if (lower.includes(sub.toLowerCase().replace(/\\/g, "/"))) return true;
  }
  for (const w of config.whitelistPaths) {
    const norm = w.replace(/\\/g, "/").replace(/^\//, "");
    if (norm.endsWith("/")) {
      if (lower.startsWith(norm.toLowerCase())) return true;
    } else if (relPosix === norm || lower === norm.toLowerCase() || relPosix.startsWith(`${norm}/`)) {
      return true;
    }
  }
  for (const c of config.criticalPaths) {
    const norm = c.replace(/\\/g, "/");
    if (relPosix === norm || relPosix.startsWith(`${norm}/`)) return true;
  }
  if (isNextAppConventionFile(relPosix)) return true;
  return false;
}

/**
 * Assets em `public/` que nunca devem ser apagados automaticamente (mesmo sem referência textual detectada).
 */
export function isPublicAssetRuntimeProtected(relPosix: string, config: CleanupEngineConfig): boolean {
  if (!relPosix.startsWith("public/")) return false;
  const base = path.posix.basename(relPosix);
  if (isProtectedPublicBasename(base, config)) return true;
  const lower = base.toLowerCase();
  if (lower.startsWith("favicon")) return true;
  if (lower.includes("manifest")) return true;
  return false;
}
