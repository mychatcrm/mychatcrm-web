import fs from "node:fs";
import path from "node:path";
import type { UnusedDependencyReport } from "./types";
import { walkSourceFiles } from "./fs-utils";

/** Dependências frequentemente usadas fora de `import` (CLI, types, configs). */
const IMPLICIT_ALLOW = new Set([
  "typescript",
  "eslint",
  "eslint-config-next",
  "autoprefixer",
  "postcss",
  "tailwindcss",
  "next-sitemap",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "tsx",
]);

function readPackageJson(projectRoot: string) {
  const raw = fs.readFileSync(path.join(projectRoot, "package.json"), "utf8");
  return JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

/** Texto agregado de ficheiros fonte (sem node_modules/.next) para procura de imports. */
function aggregateSourceText(projectRoot: string, maxChars = 6_000_000): string {
  const chunks: string[] = [];
  let total = 0;
  const roots = ["app", "components", "lib", "hooks", "services", "utils", "scripts", "middleware.ts", "instrumentation.ts"].map((r) =>
    path.join(projectRoot, r),
  );
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const stat = fs.statSync(r);
    const files = stat.isDirectory() ? walkSourceFiles(r, new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"])) : [r];
    for (const f of files) {
      if (f.includes("node_modules") || f.includes(".next")) continue;
      try {
        const t = fs.readFileSync(f, "utf8");
        chunks.push(t);
        total += t.length;
        if (total > maxChars) return chunks.join("\n");
      } catch {
        /* ignore */
      }
    }
  }
  return chunks.join("\n");
}

function depMentionedInSource(sourceBlob: string, pkg: string): boolean {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`from\\s+['"]${esc}['"]`),
    new RegExp(`import\\s*\\(\\s*['"]${esc}['"]`),
    new RegExp(`require\\s*\\(\\s*['"]${esc}['"]`),
    new RegExp(`['"]${esc}/`),
  ];
  return patterns.some((re) => re.test(sourceBlob));
}

export function analyzeUnusedDependencies(projectRoot: string): UnusedDependencyReport[] {
  const pkg = readPackageJson(projectRoot);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const blob = aggregateSourceText(projectRoot);
  const out: UnusedDependencyReport[] = [];

  for (const name of Object.keys(deps)) {
    if (IMPLICIT_ALLOW.has(name)) continue;
    if (name.startsWith("@types/")) {
      const base = name.replace(/^@types\//, "");
      if (depMentionedInSource(blob, base) || blob.includes(`@types/${base}`)) continue;
      out.push({
        name,
        confidence: "suspicious",
        reason: "@types/* sem referência textual directa (pode ser só tipos transitivos).",
      });
      continue;
    }
    if (depMentionedInSource(blob, name)) continue;
    out.push({
      name,
      confidence: "suspicious",
      reason: "Nenhum import/require dinâmico detectado no código analisado (falso positivo possível: uso em configs ou strings).",
    });
  }
  return out;
}
