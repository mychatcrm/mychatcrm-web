import fs from "node:fs";
import path from "node:path";
import type { CleanupReport } from "./types";

const CACHE_DIR = "scripts/cleanup-engine/.cache";

export function writeReport(projectRoot: string, report: CleanupReport): string {
  const dir = path.join(projectRoot, CACHE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "last-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

export function printReportHuman(report: CleanupReport) {
  const { unusedFiles, unusedExports, unusedDependencies, unusedPublicAssets, ignoredPaths, deletedFiles, errors, mode, status, durationMs } =
    report;
  console.log("\n═══ MyChatCRM Cleanup Engine ═══\n");
  console.log(`Modo: ${mode}  |  Estado: ${status}  |  ${durationMs}ms\n`);
  console.log(`— Ficheiros não alcançáveis (órfãos): ${unusedFiles.length}`);
  for (const f of unusedFiles.slice(0, 40)) {
    console.log(`  [${f.confidence}] ${f.path} — ${f.reason}`);
  }
  if (unusedFiles.length > 40) console.log(`  … +${unusedFiles.length - 40} mais`);
  console.log(`\n— Exports (heurística): ${unusedExports.length}`);
  for (const e of unusedExports.slice(0, 20)) {
    console.log(`  [${e.confidence}] ${e.file} :: ${e.exportName}`);
  }
  console.log(`\n— Dependências npm (suspeitas): ${unusedDependencies.length}`);
  for (const d of unusedDependencies.slice(0, 30)) {
    console.log(`  [${d.confidence}] ${d.name}`);
  }
  console.log(`\n— Assets em /public (suspeitos): ${unusedPublicAssets.length}`);
  for (const a of unusedPublicAssets.slice(0, 20)) {
    console.log(`  [${a.confidence}] ${a.path}`);
  }
  if (deletedFiles.length) {
    console.log(`\n— Removidos nesta execução: ${deletedFiles.length}`);
    deletedFiles.forEach((p) => console.log(`  ${p}`));
  }
  if (ignoredPaths.length) {
    console.log(`\n— Caminhos ignorados (whitelist): ${ignoredPaths.length}`);
  }
  if (errors.length) {
    console.log("\n— Erros:");
    errors.forEach((e) => console.log(`  ! ${e}`));
  }
  if (report.deep?.summary) {
    const s = report.deep.summary;
    console.log("\n— Classificação (profundo):");
    console.log(`  SAFE_REMOVE=${s.SAFE_REMOVE}  PROBABLY_UNUSED=${s.PROBABLY_UNUSED}  MANUAL_REVIEW=${s.MANUAL_REVIEW}  PROTECTED=${s.PROTECTED}`);
    console.log(`  assets referenciados: ${s.referencedAssets}`);
    if (Object.keys(s.deletedByCategory).length) {
      console.log(`  removidos por tipo: ${JSON.stringify(s.deletedByCategory)}`);
    }
  }
  console.log("\nRelatório JSON:", path.join(CACHE_DIR, "last-report.json"), "\n");
}
