/**
 * Filtro das linhas WhatsApp oferecidas no wizard de regras, por finalidade.
 *
 * Módulo isolado (sem "server-only") de propósito: a mesma regra roda no wizard
 * e é testável em unidade, sem montar o componente inteiro.
 */
import type { LeadRuleSource } from "@/lib/lead-distribution-rules";

export type LinePurpose = "forms" | "direct" | null;

/** Finalidade exigida por uma origem de regra, ou `null` quando não exige nenhuma. */
export function requiredPurposeForSource(source: LeadRuleSource | "" | null | undefined): Exclude<LinePurpose, null> | null {
  if (source === "meta_form") return "forms";
  if (source === "whatsapp_organico") return "direct";
  return null;
}

/**
 * Linhas que a regra desta origem pode usar.
 *
 * Duas garantias que não podem sair daqui:
 *
 * 1. Linha sem finalidade (`null` = livre) sempre aparece — é o padrão de quem
 *    nunca travou nada e o que mantém o comportamento anterior.
 * 2. `currentConnectionId` **nunca** é filtrada fora. Sem isso, editar uma regra
 *    cuja linha virou incompatível renderizaria um `<select>` sem opção
 *    correspondente, e o próximo save gravaria `connection_id` vazio — a regra
 *    perderia a conexão silenciosamente.
 */
export function filterConnectionsForRuleSource<T extends { id: string; purpose?: LinePurpose }>(
  connections: readonly T[],
  source: LeadRuleSource | "" | null | undefined,
  currentConnectionId?: string | null,
): T[] {
  const required = requiredPurposeForSource(source);
  if (!required) return [...connections];
  const current = currentConnectionId?.trim() || null;

  return connections.filter((connection) => {
    if (current && connection.id === current) return true;
    const purpose = connection.purpose ?? null;
    return purpose === null || purpose === required;
  });
}

/** `true` quando a conexão selecionada não bate com a finalidade exigida. */
export function isConnectionPurposeMismatch(
  purpose: LinePurpose,
  source: LeadRuleSource | "" | null | undefined,
): boolean {
  const required = requiredPurposeForSource(source);
  if (!required || purpose === null) return false;
  return purpose !== required;
}
