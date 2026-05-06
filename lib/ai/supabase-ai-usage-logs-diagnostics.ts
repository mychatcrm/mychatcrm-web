/**
 * Compat: dicas accionáveis para o painel /admin/ia (sem texto técnico cru).
 */
import { surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";

export function buildAiUsageLogsAccessHint(
  rawError: string | null | undefined,
  rawCode?: string | null,
): string | null {
  return surfacePostgrestForAdminUi(rawError, rawCode ?? null).guidance;
}
