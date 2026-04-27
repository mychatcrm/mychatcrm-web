import fs from "node:fs";
import path from "node:path";
import type { CleanupEngineConfig } from "./types";

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".md",
  ".mdx",
  ".html",
  ".yml",
  ".yaml",
]);

const STATIC_EXT =
  "\\.(png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf|eot|mp4|webm|pdf|txt|xml|json|map)(\\?[^\"'`\\s]*)?";

/** Converte `/logo.svg` ou `logo.svg` (em contexto public) para `public/logo.svg`. */
export function normalizeWebPathToPublicRef(webPath: string): string | null {
  const trimmed = webPath.split("?")[0].trim();
  if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return null;
  }
  if (trimmed.startsWith("/")) {
    const inner = trimmed.slice(1).replace(/\\/g, "/");
    if (!inner || inner.includes("..")) return null;
    /** Comentários ou docs com `/public/foo` — já é caminho relativo ao repo. */
    if (inner.startsWith("public/")) return inner;
    return `public/${inner}`;
  }
  return null;
}

function addRef(sink: Set<string>, ref: string | null) {
  if (!ref) return;
  const n = ref.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (n.startsWith("public/")) sink.add(n);
}

/**
 * Extrai referências prováveis a ficheiros servidos de `public/` (URLs começadas por `/`).
 */
export function extractPublicRefsFromText(content: string, sink: Set<string>) {
  const quotedPath = new RegExp(`["'\`](\\/[^"'\`\\\\]+${STATIC_EXT})["'\`]`, "gi");
  let m: RegExpExecArray | null;
  while ((m = quotedPath.exec(content)) !== null) {
    addRef(sink, normalizeWebPathToPublicRef(m[1]));
  }

  const urlFn = new RegExp(`url\\(\\s*["']?([^"')]+${STATIC_EXT})["']?\\s*\\)`, "gi");
  while ((m = urlFn.exec(content)) !== null) {
    addRef(sink, normalizeWebPathToPublicRef(m[1].trim()));
  }

  const jsxSrc = new RegExp(`\\bsrc=\\{\\s*["'\`](\\/[^"'\`\\\\]+${STATIC_EXT})["'\`]\\s*\\}`, "gi");
  while ((m = jsxSrc.exec(content)) !== null) {
    addRef(sink, normalizeWebPathToPublicRef(m[1]));
  }
}

function defaultScanRoots(projectRoot: string, config: CleanupEngineConfig): string[] {
  const names = ["app", "components", "lib", "hooks", "services", "utils", "styles", "scripts", ...config.assetScanExtraDirs];
  const dirs: string[] = [];
  for (const n of names) {
    const abs = path.join(projectRoot, n);
    if (fs.existsSync(abs)) dirs.push(abs);
  }
  for (const rootFile of ["middleware.ts", "instrumentation.ts"]) {
    const abs = path.join(projectRoot, rootFile);
    if (fs.existsSync(abs)) dirs.push(abs);
  }
  return dirs;
}

function readTextFilesUnder(absPath: string, out: string[]) {
  if (absPath.replace(/\\/g, "/").includes("scripts/cleanup-engine")) return;
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    const ext = path.extname(absPath).toLowerCase();
    if (TEXT_EXTS.has(ext)) out.push(absPath);
    return;
  }
  if (!stat.isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(absPath, e.name);
    if (e.isDirectory()) readTextFilesUnder(p, out);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (TEXT_EXTS.has(ext)) out.push(p);
    }
  }
}

function readRootConfigFiles(projectRoot: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const n = e.name.toLowerCase();
    if (
      n === "next.config.js" ||
      n === "next.config.mjs" ||
      n === "next.config.ts" ||
      n === "next-sitemap.config.js" ||
      n === "next-sitemap.config.cjs" ||
      n.endsWith(".config.js") ||
      n.endsWith(".config.mjs") ||
      n.endsWith(".config.ts")
    ) {
      out.push(path.join(projectRoot, e.name));
    }
  }
}

/**
 * Constrói o conjunto de caminhos `public/...` referenciados no código, configs e estilos.
 */
export function buildReferencedPublicPathSet(projectRoot: string, config: CleanupEngineConfig): Set<string> {
  const sink = new Set<string>();
  const files: string[] = [];

  for (const dir of defaultScanRoots(projectRoot, config)) {
    readTextFilesUnder(dir, files);
  }
  readRootConfigFiles(projectRoot, files);

  for (const f of files) {
    if (f.includes(`${path.sep}node_modules${path.sep}`) || f.includes(`${path.sep}.next${path.sep}`)) continue;
    if (f.includes("scripts" + path.sep + "cleanup-engine")) continue;
    let content: string;
    try {
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    extractPublicRefsFromText(content, sink);
  }

  return sink;
}
