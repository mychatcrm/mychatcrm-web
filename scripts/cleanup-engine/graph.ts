import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import type { CleanupEngineConfig } from "./types";
import { normalizeProjectPath, walkSourceFiles } from "./fs-utils";
import { readPathMappings, resolveModuleSpecifier, type PathMapping } from "./resolver";

export function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteralLike(arg0)) out.push(arg0.text);
    }
    if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal)) {
        out.push(arg.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...new Set(out)];
}

function parseSourceFile(absPath: string): ts.SourceFile {
  const text = fs.readFileSync(absPath, "utf8");
  const kind = absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, kind);
}

function collectSeedFiles(projectRoot: string): string[] {
  const seeds: string[] = [];
  const appDir = path.join(projectRoot, "app");
  if (fs.existsSync(appDir)) {
    seeds.push(...walkSourceFiles(appDir));
  }
  for (const name of ["middleware.ts", "instrumentation.ts"]) {
    const p = path.join(projectRoot, name);
    if (fs.existsSync(p)) seeds.push(p);
  }
  const pagesDir = path.join(projectRoot, "pages");
  if (fs.existsSync(pagesDir)) {
    seeds.push(...walkSourceFiles(pagesDir));
  }
  return [...new Set(seeds.map((p) => path.normalize(p)))];
}

export function buildReachableFileSet(projectRoot: string, _config: CleanupEngineConfig): Set<string> {
  const mappings = readPathMappings(projectRoot);
  const seeds = collectSeedFiles(projectRoot);
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const s of seeds) {
    const n = path.normalize(s);
    if (fs.existsSync(n) && !reachable.has(n)) {
      reachable.add(n);
      queue.push(n);
    }
  }

  while (queue.length) {
    const file = queue.pop()!;
    let sf: ts.SourceFile;
    try {
      sf = parseSourceFile(file);
    } catch {
      continue;
    }
    for (const spec of collectModuleSpecifiers(sf)) {
      const resolved = resolveModuleSpecifier(projectRoot, file, spec, mappings);
      if (!resolved) continue;
      const norm = path.normalize(resolved);
      if (!reachable.has(norm)) {
        reachable.add(norm);
        queue.push(norm);
      }
    }
  }

  return reachable;
}

export function isWhitelisted(relPosix: string, config: CleanupEngineConfig): boolean {
  const lower = relPosix.toLowerCase();
  for (const w of config.whitelistPaths) {
    const norm = w.replace(/\\/g, "/").replace(/^\//, "");
    if (norm.endsWith("/")) {
      if (lower.startsWith(norm.toLowerCase()) || relPosix.startsWith(norm)) return true;
    } else if (relPosix === norm || lower === norm.toLowerCase() || relPosix.startsWith(`${norm}/`)) {
      return true;
    }
  }
  return false;
}

export function isCritical(relPosix: string, config: CleanupEngineConfig): boolean {
  for (const c of config.criticalPaths) {
    const norm = c.replace(/\\/g, "/");
    if (relPosix === norm || relPosix.startsWith(`${norm}/`)) return true;
  }
  return false;
}

export function matchesBlacklist(relPosix: string, config: CleanupEngineConfig): boolean {
  for (const g of config.blacklistGlobs) {
    const gl = g.replace(/\\/g, "/");
    if (gl === "**/*.d.ts" && relPosix.endsWith(".d.ts")) return true;
    if (gl.includes("node_modules") && relPosix.includes("node_modules")) return true;
    if (gl.includes(".next") && relPosix.includes(".next")) return true;
  }
  return false;
}

export function listCandidateSourceFiles(projectRoot: string, config: CleanupEngineConfig): string[] {
  const files = new Set<string>();
  const appDir = path.join(projectRoot, "app");
  if (fs.existsSync(appDir)) {
    for (const f of walkSourceFiles(appDir)) files.add(path.normalize(f));
  }
  for (const root of config.scanRoots) {
    const abs = path.join(projectRoot, root);
    if (fs.existsSync(abs)) {
      for (const f of walkSourceFiles(abs)) files.add(path.normalize(f));
    }
  }
  return [...files];
}

export function classifyOrphan(
  relPosix: string,
  config: CleanupEngineConfig,
): "safe" | "suspicious" | "critical" {
  if (isCritical(relPosix, config) || isWhitelisted(relPosix, config)) return "critical";
  if (matchesBlacklist(relPosix, config)) return "critical";
  if (config.aggressiveness === "aggressive") {
    return "safe";
  }
  if (config.aggressiveness === "normal") {
    if (relPosix.startsWith("utils/") || relPosix.startsWith("hooks/")) return "safe";
    return "suspicious";
  }
  return "suspicious";
}

export function findUnreachableSourceFiles(
  projectRoot: string,
  config: CleanupEngineConfig,
): { abs: string; rel: string; confidence: "safe" | "suspicious" | "critical" }[] {
  const reachable = buildReachableFileSet(projectRoot, config);
  const candidates = listCandidateSourceFiles(projectRoot, config);
  const out: { abs: string; rel: string; confidence: "safe" | "suspicious" | "critical" }[] = [];

  for (const abs of candidates) {
    const rel = normalizeProjectPath(projectRoot, abs);
    if (isWhitelisted(rel, config) || isCritical(rel, config)) continue;
    if (!reachable.has(abs)) {
      out.push({ abs, rel, confidence: classifyOrphan(rel, config) });
    }
  }
  return out;
}
