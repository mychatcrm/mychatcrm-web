/**
 * CLI da engine profunda de limpeza.
 *
 *   npx tsx scripts/cleanup-engine/executeCleanup.ts scan|report|safe|deep [--root .] [--aggressive]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadUserConfig } from "./config";
import {
  bucketByClassification,
  printDeepReportHuman,
  summarizeCounts,
  writeJsonReport,
  writeMarkdownReport,
} from "./cleanupReport";
import {
  analyzeUnusedDependencies,
  buildUnusedFileReportsFromClassified,
  buildUnusedPublicReports,
  runDeepStaticAnalysis,
} from "./deadCodeAnalyzer";
import { isWhitelisted } from "./graph";
import { printReportHuman } from "./reporter";
import type { CleanupReport } from "./types";

type Cmd = "scan" | "report" | "safe" | "deep" | "analyze" | "execute";

function parseArgs(argv: string[]) {
  const args = { root: process.cwd(), aggressive: false, cmd: "scan" as Cmd };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) {
      args.root = path.resolve(argv[++i]);
    } else if (a === "--aggressive") {
      args.aggressive = true;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  const c = positional[0];
  if (c === "scan" || c === "report" || c === "safe" || c === "deep" || c === "analyze" || c === "execute") {
    args.cmd = c;
  }
  if (args.cmd === "analyze") args.cmd = "scan";
  if (args.cmd === "execute") args.cmd = "safe";
  return args;
}

function appendLog(logPath: string, line: string) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

function ensureLog(projectRoot: string): string {
  const dir = path.join(projectRoot, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(dir, `cleanup-${stamp}.log`);
  fs.writeFileSync(logPath, `cleanup log started ${new Date().toISOString()}\n`, "utf8");
  return logPath;
}

function runValidation(projectRoot: string, logPath: string): { ok: boolean; message: string } {
  const opts = { cwd: projectRoot, encoding: "utf8" as const, shell: true };
  const steps = [
    { cmd: "npx tsc --noEmit", label: "tsc --noEmit" },
    { cmd: "npm run lint", label: "lint" },
    { cmd: "npm run build", label: "build" },
  ];
  for (const { cmd, label } of steps) {
    appendLog(logPath, `RUN ${cmd}`);
    const r = spawnSync(cmd, { ...opts, stdio: "pipe" });
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    if (r.status !== 0) {
      appendLog(logPath, `FAIL ${label}: ${out.slice(0, 4000)}`);
      return { ok: false, message: `${label} falhou (exit ${r.status}). Ver ${logPath}` };
    }
    appendLog(logPath, `OK ${label}`);
  }
  return { ok: true, message: "tsc, lint e build concluídos com sucesso." };
}

function deleteSafeItems(
  projectRoot: string,
  report: CleanupReport,
  config: Awaited<ReturnType<typeof loadUserConfig>>,
  logPath: string,
): { deleted: string[]; errors: string[]; byCategory: Record<string, number> } {
  const deleted: string[] = [];
  const errors: string[] = [];
  const byCategory: Record<string, number> = { source: 0, asset: 0 };

  const safeList = report.deep?.classified.SAFE_REMOVE ?? [];
  for (const item of safeList) {
    if (item.path.startsWith("app/")) {
      appendLog(logPath, `SKIP (app): ${item.path}`);
      continue;
    }
    /** `public/` está na whitelist para análise de órfãos TS, não para bloquear remoção de assets classificados como seguros. */
    const isPublicAsset = item.kind === "asset" && item.path.startsWith("public/");
    if (!isPublicAsset && isWhitelisted(item.path, config)) {
      appendLog(logPath, `SKIP (whitelist): ${item.path}`);
      continue;
    }
    const abs = path.join(projectRoot, item.path);
    try {
      if (!fs.existsSync(abs)) continue;
      fs.unlinkSync(abs);
      deleted.push(item.path);
      byCategory[item.kind === "asset" ? "asset" : "source"]++;
      appendLog(logPath, `DELETED ${item.path}`);
    } catch (e) {
      const msg = `${item.path}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      appendLog(logPath, `ERROR ${msg}`);
    }
  }
  return { deleted, errors, byCategory };
}

async function buildFullReport(
  projectRoot: string,
  config: Awaited<ReturnType<typeof loadUserConfig>>,
  mode: CleanupReport["mode"],
): Promise<CleanupReport> {
  const t0 = Date.now();
  const deepPayload = runDeepStaticAnalysis(projectRoot, config);
  const buckets = bucketByClassification(deepPayload.classified);
  const unusedDeps = analyzeUnusedDependencies(projectRoot);
  const unusedFiles = buildUnusedFileReportsFromClassified(deepPayload.classified.filter((c) => c.kind === "source"));
  const unusedPublic = buildUnusedPublicReports(deepPayload.classified.filter((c) => c.kind === "asset"));
  const ignoredPaths = [...config.whitelistPaths, ...config.criticalPaths];

  const report: CleanupReport = {
    generatedAt: new Date().toISOString(),
    mode,
    status: "ok",
    unusedFiles,
    unusedExports: [],
    unusedDependencies: unusedDeps,
    unusedPublicAssets: unusedPublic,
    ignoredPaths,
    deletedFiles: [],
    errors: [],
    durationMs: Date.now() - t0,
    deep: {
      classified: buckets,
      legacyHints: deepPayload.legacyHints,
      duplicateGroups: deepPayload.duplicateGroups,
      referencedPublicPaths: deepPayload.referencedPublicPaths,
      summary: summarizeCounts(buckets, deepPayload.referencedPublicPaths.length, {}),
    },
  };
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const { root, aggressive, cmd } = parseArgs(argv);
  process.chdir(root);

  let config = await loadUserConfig(root);
  if (aggressive) {
    config = { ...config, aggressiveness: "aggressive" };
  }

  const logPath = ensureLog(root);
  appendLog(logPath, `cmd=${cmd} root=${root} aggressive=${aggressive}`);

  const mode: CleanupReport["mode"] =
    cmd === "scan" ? "scan" : cmd === "report" ? "report" : cmd === "safe" ? "safe" : cmd === "deep" ? "deep" : "dry-run";

  if (cmd === "scan" || cmd === "report") {
    const report = await buildFullReport(root, config, mode);
    const jsonPath = writeJsonReport(root, report);
    appendLog(logPath, `json report: ${jsonPath}`);
    if (cmd === "report") {
      const md = writeMarkdownReport(root, report);
      if (md) {
        report.deep!.markdownReport = md;
        writeJsonReport(root, report);
        appendLog(logPath, `markdown report: ${md}`);
      }
    }
    printReportHuman(report);
    printDeepReportHuman(report);
    console.log(`\nLog: ${logPath}`);
    console.log(`JSON: ${jsonPath}`);
    if (cmd === "report" && report.deep?.markdownReport) console.log(`Markdown: ${report.deep.markdownReport}`);
    process.exit(0);
    return;
  }

  if (cmd === "safe" || cmd === "deep") {
    const pre = await buildFullReport(root, config, mode === "deep" ? "deep" : "safe");
    const { deleted, errors, byCategory } = deleteSafeItems(root, pre, config, logPath);
    const postReport: CleanupReport = {
      ...pre,
      deletedFiles: deleted,
      errors,
      status: errors.length ? "partial" : "ok",
      deep: pre.deep
        ? {
            ...pre.deep,
            summary: summarizeCounts(pre.deep.classified, pre.deep.referencedPublicPaths.length, {
              source: byCategory.source,
              asset: byCategory.asset,
            }),
            logFile: logPath,
          }
        : undefined,
    };
    if (postReport.deep) {
      postReport.deep.logFile = logPath;
    }
    writeJsonReport(root, postReport);
    const mdPath = writeMarkdownReport(root, postReport);
    if (mdPath && postReport.deep) {
      postReport.deep.markdownReport = mdPath;
      writeJsonReport(root, postReport);
    }
    printReportHuman(postReport);
    printDeepReportHuman(postReport);
    console.log(`\nRemovidos: ${deleted.length} | Erros: ${errors.length}`);
    console.log(`Log: ${logPath}`);

    if (cmd === "deep") {
      const v = runValidation(root, logPath);
      if (!v.ok) {
        console.error(`\n${v.message}`);
        postReport.status = "error";
        postReport.errors.push(v.message);
        writeJsonReport(root, postReport);
        process.exit(1);
        return;
      }
      console.log(`\n${v.message}`);
    } else if (config.validateBuildAfterExecute) {
      const v = runValidation(root, logPath);
      if (!v.ok) console.warn(`\nAviso: ${v.message}`);
    }
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.error("Comando desconhecido. Use: scan | report | safe | deep");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
