import fs from "node:fs";
import path from "node:path";

const EXT_ORDER = [".tsx", ".ts", ".mts", ".cts", "/index.tsx", "/index.ts"];

export interface PathMapping {
  pattern: string;
  paths: string[];
}

/** Lê paths do tsconfig (ex.: `@/*` -> `./*`). */
export function readPathMappings(projectRoot: string): PathMapping[] {
  const configPath = path.join(projectRoot, "tsconfig.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const json = JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } };
  const paths = json.compilerOptions?.paths ?? {};
  const out: PathMapping[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (targets?.length) out.push({ pattern, paths: targets });
  }
  return out;
}

function tryFile(base: string): string | null {
  for (const ext of EXT_ORDER) {
    const candidate = ext.startsWith("/") ? base + ext : base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.normalize(candidate);
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return path.normalize(base);
  return null;
}

/** Resolve um especificador de módulo para caminho absoluto de ficheiro, ou null (pacote externo / não encontrado). */
export function resolveModuleSpecifier(
  projectRoot: string,
  fromFile: string,
  specifier: string,
  mappings: PathMapping[],
): string | null {
  if (!specifier || specifier.startsWith("node:")) return null;

  for (const m of mappings) {
    if (!m.pattern.endsWith("*")) continue;
    const prefix = m.pattern.slice(0, -1);
    if (!specifier.startsWith(prefix)) continue;
    const sub = specifier.slice(prefix.length);
    const target = m.paths[0]?.replace(/\*$/, "") ?? ".";
    const abs = path.resolve(projectRoot, target, sub);
    const hit = tryFile(abs);
    if (hit) return hit;
  }

  if (specifier.startsWith("@/")) {
    const abs = path.resolve(projectRoot, specifier.slice(2));
    return tryFile(abs);
  }

  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    return tryFile(base);
  }

  if (specifier.startsWith("/")) {
    return tryFile(path.join(projectRoot, specifier.slice(1)));
  }

  return null;
}
