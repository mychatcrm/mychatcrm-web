import fs from "node:fs";
import path from "node:path";
import type { ClassifiedPath, CleanupReport, CleanupSummaryCounts, RemovalClassification } from "./types";

const CACHE_DIR = "scripts/cleanup-engine/.cache";

export function bucketByClassification(classified: ClassifiedPath[]): Record<RemovalClassification, ClassifiedPath[]> {
  const empty = (): ClassifiedPath[] => [];
  const buckets: Record<RemovalClassification, ClassifiedPath[]> = {
    SAFE_REMOVE: empty(),
    PROBABLY_UNUSED: empty(),
    MANUAL_REVIEW: empty(),
    PROTECTED: empty(),
  };
  for (const c of classified) {
    buckets[c.classification].push(c);
  }
  return buckets;
}

export function summarizeCounts(
  buckets: Record<RemovalClassification, ClassifiedPath[]>,
  referencedAssetCount: number,
  deletedByCategory: Record<string, number>,
): CleanupSummaryCounts {
  return {
    SAFE_REMOVE: buckets.SAFE_REMOVE.length,
    PROBABLY_UNUSED: buckets.PROBABLY_UNUSED.length,
    MANUAL_REVIEW: buckets.MANUAL_REVIEW.length,
    PROTECTED: buckets.PROTECTED.length,
    referencedAssets: referencedAssetCount,
    deletedByCategory,
  };
}

export function writeJsonReport(projectRoot: string, report: CleanupReport): string {
  const dir = path.join(projectRoot, CACHE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "last-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

export function writeMarkdownReport(projectRoot: string, report: CleanupReport): string | undefined {
  if (!report.deep) return undefined;
  const dir = path.join(projectRoot, CACHE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "last-report.md");
  const lines: string[] = [];
  lines.push(`# Cleanup report`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode} | Status: ${report.status} | ${report.durationMs}ms\n`);

  const s = report.deep.summary;
  lines.push("## Summary counts\n");
  lines.push(`| Bucket | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| SAFE_REMOVE | ${s.SAFE_REMOVE} |`);
  lines.push(`| PROBABLY_UNUSED | ${s.PROBABLY_UNUSED} |`);
  lines.push(`| MANUAL_REVIEW | ${s.MANUAL_REVIEW} |`);
  lines.push(`| PROTECTED | ${s.PROTECTED} |`);
  lines.push(`| referenced public assets | ${s.referencedAssets} |\n`);

  function section(title: string, items: ClassifiedPath[]) {
    lines.push(`## ${title} (${items.length})\n`);
    for (const it of items) {
      lines.push(`- **${it.path}** (${it.kind})`);
      lines.push(`  - ${it.reason}`);
      if (it.substituteCandidate) lines.push(`  - substitute: \`${it.substituteCandidate}\``);
      if (it.references.length) lines.push(`  - refs: ${it.references.join(", ")}`);
    }
    lines.push("");
  }

  for (const k of ["SAFE_REMOVE", "PROBABLY_UNUSED", "MANUAL_REVIEW", "PROTECTED"] as const) {
    section(k, report.deep.classified[k]);
  }

  if (report.deep.legacyHints.length) {
    lines.push("## Legacy / similarity hints\n");
    for (const h of report.deep.legacyHints) {
      lines.push(`- \`${h.path}\` → ${h.similarTo ? `\`${h.similarTo}\`` : "(none)"} — ${h.reason}`);
    }
    lines.push("");
  }

  if (report.deep.duplicateGroups.length) {
    lines.push("## Duplicate asset groups (hash)\n");
    for (const g of report.deep.duplicateGroups) {
      lines.push(`- hash \`${g.hash.slice(0, 12)}…\`: ${g.paths.join(", ")}${g.referencedPath ? ` (referenced: ${g.referencedPath})` : ""}`);
    }
    lines.push("");
  }

  if (report.deletedFiles.length) {
    lines.push("## Deleted in this run\n");
    report.deletedFiles.forEach((p) => lines.push(`- ${p}`));
    lines.push("");
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return outPath;
}

export function printDeepReportHuman(report: CleanupReport) {
  if (!report.deep) return;
  const d = report.deep;
  console.log("\n── Classificação profunda ──\n");
  for (const tier of ["SAFE_REMOVE", "PROBABLY_UNUSED", "MANUAL_REVIEW", "PROTECTED"] as const) {
    const items = d.classified[tier];
    console.log(`${tier}: ${items.length}`);
    for (const it of items.slice(0, 25)) {
      console.log(`  • ${it.path} — ${it.reason}`);
    }
    if (items.length > 25) console.log(`  … +${items.length - 25} mais`);
  }
  console.log(`\nAssets públicos referenciados (scanner): ${d.referencedPublicPaths.length}`);
  if (d.duplicateGroups.length) {
    console.log(`\nGrupos duplicados (hash) em public/: ${d.duplicateGroups.length}`);
  }
}
