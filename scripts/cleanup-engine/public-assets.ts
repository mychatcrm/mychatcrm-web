import fs from "node:fs";
import path from "node:path";
import { buildReferencedPublicPathSet } from "./assetReferenceScanner";
import { defaultConfig } from "./config";
import type { CleanupEngineConfig, UnusedPublicAssetReport } from "./types";

function walkPublicFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(dir);
  return out;
}

/**
 * Lista ficheiros em `public/` sem referência detectada pelo `assetReferenceScanner`.
 * Preferir `deadCodeAnalyzer.runDeepStaticAnalysis` para classificação completa.
 */
export function analyzePublicAssets(projectRoot: string, config?: CleanupEngineConfig): UnusedPublicAssetReport[] {
  const merged: CleanupEngineConfig = { ...defaultConfig, ...config, projectRoot };
  const publicDir = path.join(projectRoot, "public");
  const files = walkPublicFiles(publicDir);
  const refs = buildReferencedPublicPathSet(projectRoot, merged);
  const out: UnusedPublicAssetReport[] = [];

  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
    const base = path.basename(abs);
    if (/^sitemap.*\.xml$/i.test(base) || base.toLowerCase() === "robots.txt") continue;
    if (refs.has(rel)) continue;
    out.push({
      path: rel,
      confidence: "suspicious",
      reason: "Sem referência detectada pelo scanner de assets (metadata, JSX, CSS, configs). Pode ser URL externa ou falso positivo.",
    });
  }
  return out;
}
