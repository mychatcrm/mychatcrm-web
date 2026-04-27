import fs from "node:fs";
import path from "node:path";

const SKIP_DIR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);

export function walkSourceFiles(root: string, exts = new Set([".ts", ".tsx"])): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (exts.has(ext)) out.push(path.join(dir, e.name));
      }
    }
  }
  walk(root);
  return out;
}

export function normalizeProjectPath(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath);
  return rel.split(path.sep).join("/");
}

export function isUnderDir(file: string, dirAbs: string): boolean {
  const rel = path.relative(dirAbs, file);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
