import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CrawledFile } from "./fileCrawler";
import type { CleanupEngineConfig, DuplicateGroup, LegacyPairHint } from "./types";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif"]);

const MAX_HASH_BYTES = 2 * 1024 * 1024;

export function basenameLooksLegacy(basename: string, config: CleanupEngineConfig): boolean {
  for (const pat of config.legacyBasenamePatterns) {
    try {
      if (new RegExp(pat, "i").test(basename)) return true;
    } catch {
      /* ignore invalid user regex */
    }
  }
  return false;
}

function stripLegacyTokens(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/\b(old|backup|bkp|deprecated|unused|temp|copy|legacy|antig|prev|previous|v\d+)\b/gi, "")
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
}

/**
 * Heurística: ficheiros na mesma pasta com stem semelhante (ex.: logo-oficial vs logo).
 */
export function findSimilarReferencedInDir(
  unrefPath: string,
  referencedBasenamesInDir: Map<string, Set<string>>,
  referencedPublicPaths: Set<string>,
): string | undefined {
  const dir = path.posix.dirname(unrefPath);
  const base = path.posix.basename(unrefPath);
  const stem = stripLegacyTokens(base);
  if (stem.length < 2) return undefined;

  const inDir = referencedBasenamesInDir.get(dir);
  if (!inDir) return undefined;

  for (const other of inDir) {
    if (other === base) continue;
    const oStem = stripLegacyTokens(other);
    if (!oStem) continue;
    if (oStem === stem || oStem.includes(stem) || stem.includes(oStem)) {
      const candidate = `${dir}/${other}`;
      if (referencedPublicPaths.has(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Outro ficheiro com "logo" no nome na mesma pasta, referenciado (ex.: logo-oficial vs logo.svg). */
export function findReferencedLogoSibling(
  unrefPath: string,
  referencedBasenamesInDir: Map<string, Set<string>>,
  referencedPublicPaths: Set<string>,
): string | undefined {
  const dir = path.posix.dirname(unrefPath);
  const base = path.posix.basename(unrefPath);
  if (!/logo/i.test(base)) return undefined;
  const inDir = referencedBasenamesInDir.get(dir);
  if (!inDir) return undefined;
  for (const other of inDir) {
    if (other === base || !/logo/i.test(other)) continue;
    const candidate = `${dir}/${other}`;
    if (referencedPublicPaths.has(candidate)) return candidate;
  }
  return undefined;
}

export function buildReferencedBasenamesByDir(referencedPublicPaths: Set<string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of referencedPublicPaths) {
    const dir = path.posix.dirname(p);
    const base = path.posix.basename(p);
    if (!map.has(dir)) map.set(dir, new Set());
    map.get(dir)!.add(base);
  }
  return map;
}

export function sha256FileShort(absPath: string): string | null {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile() || st.size > MAX_HASH_BYTES) return null;
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

export function findDuplicateAssetGroups(
  publicFiles: CrawledFile[],
  referencedPublicPaths: Set<string>,
): DuplicateGroup[] {
  const byHash = new Map<string, string[]>();
  for (const f of publicFiles) {
    if (!IMAGE_EXT.has(f.ext)) continue;
    const h = sha256FileShort(f.abs);
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h)!.push(f.rel.replace(/\\/g, "/"));
  }

  const groups: DuplicateGroup[] = [];
  for (const [hash, paths] of byHash) {
    if (paths.length < 2) continue;
    const referencedPath = paths.find((p) => referencedPublicPaths.has(p));
    groups.push({ hash, paths, referencedPath });
  }
  return groups;
}

export function legacyHintsFromPublic(
  unreferencedPublicRels: string[],
  referencedPublicPaths: Set<string>,
  config: CleanupEngineConfig,
): LegacyPairHint[] {
  const byDir = buildReferencedBasenamesByDir(referencedPublicPaths);
  const hints: LegacyPairHint[] = [];
  for (const rel of unreferencedPublicRels) {
    const base = path.posix.basename(rel);
    const similar =
      findSimilarReferencedInDir(rel, byDir, referencedPublicPaths) ?? findReferencedLogoSibling(rel, byDir, referencedPublicPaths);
    if (similar) {
      hints.push({
        path: rel,
        similarTo: similar,
        reason: "Ficheiro na mesma pasta com nome/stem semelhante a um asset referenciado.",
      });
    } else if (basenameLooksLegacy(base, config)) {
      hints.push({
        path: rel,
        similarTo: "",
        reason: "Nome sugere cópia de segurança ou versão antiga (padrão legacy).",
      });
    }
  }
  return hints;
}
