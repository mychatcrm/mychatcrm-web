import fs from "node:fs";
import path from "node:path";

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "out",
]);

export interface CrawledFile {
  abs: string;
  /** Relativo à raiz do projeto, POSIX. */
  rel: string;
  ext: string;
  size: number;
}

function shouldSkipDir(relPosix: string): boolean {
  return relPosix === "scripts/cleanup-engine/.cache" || relPosix.startsWith("scripts/cleanup-engine/.cache/");
}

/**
 * Varredura recursiva da raiz do projeto (exclui artefactos de build e dependências).
 */
export function crawlProjectFiles(projectRoot: string, extraSkipDirs: string[] = []): CrawledFile[] {
  const skip = new Set([...DEFAULT_SKIP_DIRS, ...extraSkipDirs]);
  const out: CrawledFile[] = [];
  const rootNorm = path.normalize(projectRoot);

  function walk(absDir: string, relFromRoot: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "." || e.name === "..") continue;
      const abs = path.join(absDir, e.name);
      const rel = relFromRoot ? `${relFromRoot}/${e.name}` : e.name;
      const relPosix = rel.split(path.sep).join("/");

      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        if (shouldSkipDir(relPosix)) continue;
        walk(abs, rel);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(abs);
          out.push({
            abs,
            rel: relPosix,
            ext: path.extname(e.name).toLowerCase(),
            size: st.size,
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  walk(rootNorm, "");
  return out;
}
