import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CleanupEngineConfig } from "./types";

/** Padrões case-insensitive sobre o basename (sem path). */
const LEGACY_BASENAME_REGEX = [
  "(^|[-_\\s])(old|backup|bkp|deprecated|unused|temp|copy|duplicate|v\\d+)([-_\\s]|\\.|$)",
  "(old|backup|deprecated|copy|temp|unused)[-_\\s]",
  "[-_\\s](old|backup|antig|legacy|prev|previous)([-_\\s]|\\.|$)",
];

export const defaultConfig: CleanupEngineConfig = {
  scanRoots: ["components", "lib", "hooks", "services", "utils", "styles"],
  assetScanExtraDirs: [],
  legacyBasenamePatterns: LEGACY_BASENAME_REGEX,
  protectedPublicBasenames: [
    "robots.txt",
    "favicon.ico",
    "manifest.json",
    "manifest.webmanifest",
    ".well-known",
  ],
  protectedPathSubstrings: [
    "middleware.ts",
    "instrumentation.ts",
    "next.config",
    "tailwind.config",
    "postcss.config",
    "tsconfig",
    "package.json",
    "app/layout.tsx",
    "app/globals.css",
    "cleanup.config.ts",
    "scripts/cleanup-engine",
  ],
  whitelistPaths: [
    "next-env.d.ts",
    "middleware.ts",
    "instrumentation.ts",
    "scripts/",
    "node_modules/",
    ".next/",
    "public/",
    "app/",
    "next.config.mjs",
    "next-sitemap.config.js",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    ".env",
    ".env.local",
    ".env.example",
    "cleanup.config.ts",
    "scripts/cleanup-engine/",
  ],
  criticalPaths: [
    "next.config.mjs",
    "tsconfig.json",
    "package.json",
    "app/layout.tsx",
    "app/globals.css",
  ],
  blacklistGlobs: ["**/*.d.ts", "**/.next/**", "**/node_modules/**"],
  aggressiveness: "conservative",
  projectRoot: process.cwd(),
  analyzeNamedExportsHeuristic: false,
  validateBuildAfterExecute: false,
};

/** Carrega `cleanup.config.ts` na raiz do projeto, se existir, e faz merge com defaults. */
export async function loadUserConfig(projectRoot: string): Promise<CleanupEngineConfig> {
  const fs = await import("node:fs/promises");
  const userPath = path.join(projectRoot, "cleanup.config.ts");
  try {
    await fs.access(userPath);
  } catch {
    return { ...defaultConfig, projectRoot };
  }
  const url = `${pathToFileURL(userPath).href}?t=${Date.now()}`;
  const mod = (await import(url)) as { default?: Partial<CleanupEngineConfig>; config?: Partial<CleanupEngineConfig> };
  const user = mod.default ?? mod.config ?? {};
  return {
    ...defaultConfig,
    ...user,
    projectRoot,
    whitelistPaths: [...defaultConfig.whitelistPaths, ...(user.whitelistPaths ?? [])],
    criticalPaths: [...defaultConfig.criticalPaths, ...(user.criticalPaths ?? [])],
    blacklistGlobs: [...defaultConfig.blacklistGlobs, ...(user.blacklistGlobs ?? [])],
    scanRoots: user.scanRoots ?? defaultConfig.scanRoots,
    assetScanExtraDirs: [...defaultConfig.assetScanExtraDirs, ...(user.assetScanExtraDirs ?? [])],
    legacyBasenamePatterns: user.legacyBasenamePatterns ?? defaultConfig.legacyBasenamePatterns,
    protectedPublicBasenames: [...defaultConfig.protectedPublicBasenames, ...(user.protectedPublicBasenames ?? [])],
    protectedPathSubstrings: [...defaultConfig.protectedPathSubstrings, ...(user.protectedPathSubstrings ?? [])],
    analyzeNamedExportsHeuristic: user.analyzeNamedExportsHeuristic ?? defaultConfig.analyzeNamedExportsHeuristic,
    validateBuildAfterExecute: user.validateBuildAfterExecute ?? defaultConfig.validateBuildAfterExecute,
  };
}
