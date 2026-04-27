/** Nível de confiança para remoção automática (motor legado / compat). */
export type CleanupConfidence = "safe" | "suspicious" | "critical";

export type Aggressiveness = "conservative" | "normal" | "aggressive";

/** Classificação explícita para relatório profundo e remoção segura. */
export type RemovalClassification = "SAFE_REMOVE" | "PROBABLY_UNUSED" | "MANUAL_REVIEW" | "PROTECTED";

export interface CleanupEngineConfig {
  /** Pastas onde procurar ficheiros candidatos a órfãos (além de `app/` que são sempre entradas). */
  scanRoots: string[];
  /** Prefixos de caminho (relativos à raiz do repo) nunca apagados nem reportados como órfãos. */
  whitelistPaths: string[];
  /** Caminhos sempre tratados como críticos (nunca apagar). */
  criticalPaths: string[];
  /** Padrões glob: ficheiros ignorados na análise de órfãos. */
  blacklistGlobs: string[];
  aggressiveness: Aggressiveness;
  /** Raiz do projeto (predefinido: cwd). */
  projectRoot: string;
  /** Incluir análise heurística de exports nomeados pouco referenciados (desligado por omissão — muitos falsos positivos). */
  analyzeNamedExportsHeuristic: boolean;
  /** Em `execute` legado, correr `npm run build` depois (falha não reverte ficheiros). */
  validateBuildAfterExecute: boolean;
  /** Pastas extra a incluir na agregação de referências a assets (ex.: `content`, `data`). */
  assetScanExtraDirs: string[];
  /** Regex (basename) para marcar nomes legados / cópias — usado em PROBABLY_UNUSED / SAFE_REMOVE combinado com outras provas. */
  legacyBasenamePatterns: string[];
  /** Basenames em `public/` nunca apagados automaticamente (convenção + gerados). */
  protectedPublicBasenames: string[];
  /** Substrings de caminho: se coincidir, classificar como PROTECTED. */
  protectedPathSubstrings: string[];
}

export interface UnusedFileReport {
  path: string;
  confidence: CleanupConfidence;
  reason: string;
}

export interface UnusedExportReport {
  file: string;
  exportName: string;
  confidence: CleanupConfidence;
  reason: string;
}

export interface UnusedDependencyReport {
  name: string;
  confidence: CleanupConfidence;
  reason: string;
}

export interface UnusedPublicAssetReport {
  path: string;
  confidence: CleanupConfidence;
  reason: string;
}

export interface ClassifiedPath {
  path: string;
  kind: "source" | "asset" | "config" | "other";
  classification: RemovalClassification;
  reason: string;
  references: string[];
  substituteCandidate?: string;
}

export interface LegacyPairHint {
  path: string;
  similarTo: string;
  reason: string;
}

export interface DuplicateGroup {
  hash: string;
  paths: string[];
  /** Caminho referenciado no projeto, se existir no grupo. */
  referencedPath?: string;
}

export interface CleanupSummaryCounts {
  SAFE_REMOVE: number;
  PROBABLY_UNUSED: number;
  MANUAL_REVIEW: number;
  PROTECTED: number;
  referencedAssets: number;
  deletedByCategory: Record<string, number>;
}

export interface CleanupReport {
  generatedAt: string;
  mode: "dry-run" | "execute" | "scan" | "report" | "safe" | "deep";
  status: "ok" | "partial" | "error";
  unusedFiles: UnusedFileReport[];
  unusedExports: UnusedExportReport[];
  unusedDependencies: UnusedDependencyReport[];
  unusedPublicAssets: UnusedPublicAssetReport[];
  ignoredPaths: string[];
  deletedFiles: string[];
  errors: string[];
  durationMs: number;
  /** Relatório profundo (classificação, duplicados, legado). */
  deep?: {
    classified: Record<RemovalClassification, ClassifiedPath[]>;
    legacyHints: LegacyPairHint[];
    duplicateGroups: DuplicateGroup[];
    referencedPublicPaths: string[];
    summary: CleanupSummaryCounts;
    logFile?: string;
    markdownReport?: string;
  };
}
