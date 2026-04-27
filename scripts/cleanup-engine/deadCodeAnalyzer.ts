import fs from "node:fs";
import path from "node:path";
import { buildReferencedPublicPathSet } from "./assetReferenceScanner";
import { crawlProjectFiles } from "./fileCrawler";
import { findUnreachableSourceFiles } from "./graph";
import { analyzeUnusedDependencies } from "./npm-deps";
import {
  basenameLooksLegacy,
  buildReferencedBasenamesByDir,
  findDuplicateAssetGroups,
  findReferencedLogoSibling,
  findSimilarReferencedInDir,
  legacyHintsFromPublic,
} from "./duplicateAndLegacyDetector";
import { isPublicAssetRuntimeProtected, isProtectedPath } from "./runtimeSafetyGuards";
import type {
  ClassifiedPath,
  CleanupEngineConfig,
  RemovalClassification,
  UnusedFileReport,
  UnusedPublicAssetReport,
} from "./types";

function listPublicFiles(projectRoot: string): { abs: string; rel: string }[] {
  const dir = path.join(projectRoot, "public");
  const out: { abs: string; rel: string }[] = [];
  if (!fs.existsSync(dir)) return out;
  function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ abs: p, rel: path.relative(projectRoot, p).split(path.sep).join("/") });
    }
  }
  walk(dir);
  return out;
}

function isReferenced(relPublic: string, referenced: Set<string>): boolean {
  if (referenced.has(relPublic)) return true;
  const noQuery = relPublic.split("?")[0];
  if (referenced.has(noQuery)) return true;
  return false;
}

/**
 * Classifica cada ficheiro em `public/` não referenciado pelo scanner.
 */
export function classifyUnreferencedPublicAssets(
  projectRoot: string,
  config: CleanupEngineConfig,
  referencedPublicPaths: Set<string>,
): ClassifiedPath[] {
  const files = listPublicFiles(projectRoot);
  const crawled = crawlProjectFiles(projectRoot).filter((f) => f.rel.startsWith("public/"));
  const duplicateGroups = findDuplicateAssetGroups(crawled, referencedPublicPaths);
  const unreferencedDupes = new Set<string>();
  for (const g of duplicateGroups) {
    if (!g.referencedPath) continue;
    for (const p of g.paths) {
      if (p !== g.referencedPath && !referencedPublicPaths.has(p)) unreferencedDupes.add(p);
    }
  }

  const byDir = buildReferencedBasenamesByDir(referencedPublicPaths);
  const out: ClassifiedPath[] = [];

  for (const { rel } of files) {
    if (isReferenced(rel, referencedPublicPaths)) continue;

    if (isPublicAssetRuntimeProtected(rel, config)) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "PROTECTED",
        reason: "Convenção (robots, sitemap, favicon, manifest) ou basename protegido — não remover automaticamente.",
        references: [],
      });
      continue;
    }

    if (unreferencedDupes.has(rel)) {
      const group = duplicateGroups.find((g) => g.paths.includes(rel) && g.referencedPath);
      out.push({
        path: rel,
        kind: "asset",
        classification: "SAFE_REMOVE",
        reason: "Duplicado byte-a-byte de outro ficheiro `public/` que está referenciado.",
        references: group?.referencedPath ? [`referenced:${group.referencedPath}`] : [],
        substituteCandidate: group?.referencedPath,
      });
      continue;
    }

    const base = path.posix.basename(rel);
    const legacyName = basenameLooksLegacy(base, config);
    const similar = findSimilarReferencedInDir(rel, byDir, referencedPublicPaths) ?? findReferencedLogoSibling(rel, byDir, referencedPublicPaths);

    /**
     * Variante de asset não referenciada, com substituto canónico em uso na mesma pasta.
     * Critério restrito (palavras no path) para evitar apagar ficheiros ambíguos.
     */
    const stemForVariant = base.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const variantWithReferencedSubstitute =
      similar &&
      /\b(oficial|alternativa|alternate|export|print|logoalt|altlogo|backuplogo)\b/i.test(stemForVariant);

    if (variantWithReferencedSubstitute) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "SAFE_REMOVE",
        reason:
          "Sem referências no código; existe na mesma pasta um asset semelhante referenciado e o nome indica variante (oficial/export/alt/…).",
        references: [`similar:${similar}`],
        substituteCandidate: similar,
      });
      continue;
    }

    if (legacyName && similar) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "SAFE_REMOVE",
        reason: "Nome legacy/cópia e existe substituto referenciado na mesma pasta.",
        references: [`similar:${similar}`],
        substituteCandidate: similar,
      });
      continue;
    }

    if (legacyName) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "PROBABLY_UNUSED",
        reason: "Nome sugere versão antiga/cópia; sem substituto referenciado detectado na mesma pasta.",
        references: [],
      });
      continue;
    }

    if (similar) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "MANUAL_REVIEW",
        reason: "Sem referência textual; existe ficheiro semelhante referenciado (possível logo antiga substituída).",
        references: [`similar:${similar}`],
        substituteCandidate: similar,
      });
      continue;
    }

    const lower = base.toLowerCase();
    if (lower.startsWith("og-") || lower.includes("opengraph") || lower.includes("social")) {
      out.push({
        path: rel,
        kind: "asset",
        classification: "MANUAL_REVIEW",
        reason: "Possível imagem OG/social — pode ser usada só em metadata, partilha externa ou CDN.",
        references: [],
      });
      continue;
    }

    out.push({
      path: rel,
      kind: "asset",
      classification: "PROBABLY_UNUSED",
      reason: "Sem referência detectada no código/configs analisados.",
      references: [],
    });
  }

  return out;
}

export function classifyOrphanSourceFiles(projectRoot: string, config: CleanupEngineConfig): ClassifiedPath[] {
  const orphans = findUnreachableSourceFiles(projectRoot, config);
  const out: ClassifiedPath[] = [];
  for (const o of orphans) {
    let classification: RemovalClassification = "MANUAL_REVIEW";
    let reason =
      o.confidence === "safe"
        ? "Módulo TS/TSX não alcançável a partir das entradas (app/, middleware) com a política actual."
        : "Módulo não alcançável — rever import dinâmico, convenções Next ou scripts externos.";
    if (o.confidence === "critical" || isProtectedPath(o.rel, config)) {
      classification = "PROTECTED";
      reason = "Whitelist, caminho crítico ou exclusão por convenção — não remover.";
    } else if (o.confidence === "safe") {
      classification = "SAFE_REMOVE";
    } else if (o.confidence === "suspicious") {
      classification = "MANUAL_REVIEW";
    }
    out.push({
      path: o.rel,
      kind: "source",
      classification,
      reason,
      references: [],
    });
  }
  return out;
}

export function buildUnusedPublicReports(classified: ClassifiedPath[]): UnusedPublicAssetReport[] {
  return classified
    .filter((c) => c.kind === "asset" && c.classification !== "PROTECTED")
    .map((c) => ({
      path: c.path,
      confidence: c.classification === "SAFE_REMOVE" ? "safe" : c.classification === "PROBABLY_UNUSED" ? "suspicious" : "suspicious",
      reason: `[${c.classification}] ${c.reason}`,
    }));
}

export function buildUnusedFileReportsFromClassified(classified: ClassifiedPath[]): UnusedFileReport[] {
  return classified
    .filter((c) => c.kind === "source" && c.classification !== "PROTECTED")
    .map((c) => ({
      path: c.path,
      confidence: c.classification === "SAFE_REMOVE" ? "safe" : c.classification === "PROTECTED" ? "critical" : "suspicious",
      reason: `[${c.classification}] ${c.reason}`,
    }));
}

export interface DeepAnalysisPayload {
  referencedPublicPaths: string[];
  classified: ClassifiedPath[];
  legacyHints: ReturnType<typeof legacyHintsFromPublic>;
  duplicateGroups: ReturnType<typeof findDuplicateAssetGroups>;
}

export function runDeepStaticAnalysis(projectRoot: string, config: CleanupEngineConfig): DeepAnalysisPayload {
  const referencedSet = buildReferencedPublicPathSet(projectRoot, config);
  const referencedPublicPaths = [...referencedSet].sort();

  const assetClassified = classifyUnreferencedPublicAssets(projectRoot, config, referencedSet);
  const sourceClassified = classifyOrphanSourceFiles(projectRoot, config);

  const unrefAssets = assetClassified.filter((c) => c.kind === "asset").map((c) => c.path);
  const legacyHints = legacyHintsFromPublic(unrefAssets, referencedSet, config);

  const crawledPublic = crawlProjectFiles(projectRoot).filter((f) => f.rel.startsWith("public/"));
  const duplicateGroups = findDuplicateAssetGroups(crawledPublic, referencedSet);

  return {
    referencedPublicPaths,
    classified: [...sourceClassified, ...assetClassified],
    legacyHints,
    duplicateGroups,
  };
}

export { analyzeUnusedDependencies };
