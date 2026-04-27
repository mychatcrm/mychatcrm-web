/**
 * Configuração opcional do motor de limpeza (`npm run clean:scan` / `clean:report`).
 * Faz merge com os defaults em `scripts/cleanup-engine/config.ts`.
 *
 * Campos extra opcionais (ver `CleanupEngineConfig` em `scripts/cleanup-engine/types.ts`):
 * - `assetScanExtraDirs` — pastas adicionais para procurar referências a `/public/...`
 * - `legacyBasenamePatterns` — regex sobre basename para marcar cópias antigas
 * - `protectedPublicBasenames` / `protectedPathSubstrings` — nunca apagar automaticamente
 */
const config = {
  aggressiveness: "conservative" as const,
  /** Caminhos relativos à raiz do repo — nunca apagados / ignorados na lista de órfãos. */
  whitelistPaths: [] as string[],
  criticalPaths: [] as string[],
  blacklistGlobs: [] as string[],
  scanRoots: ["components", "lib", "hooks", "services", "utils", "styles"] as string[],
  /** Pastas extra para o scanner de referências a assets (além de app, components, lib, …). */
  assetScanExtraDirs: [] as string[],
  analyzeNamedExportsHeuristic: false,
  /** Após `clean:safe` legado, sugerir validação (o fluxo `clean:deep` valida sempre). */
  validateBuildAfterExecute: false,
};

export default config;
