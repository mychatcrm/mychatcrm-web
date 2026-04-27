/**
 * Grafo de dependências entre módulos TS/JS (AST via TypeScript).
 * A resolução e o BFS estão em `graph.ts`; este módulo expõe API estável para a engine profunda.
 */
export {
  buildReachableFileSet,
  collectModuleSpecifiers,
  findUnreachableSourceFiles,
  isWhitelisted,
  isCritical,
  listCandidateSourceFiles,
  matchesBlacklist,
} from "./graph";
