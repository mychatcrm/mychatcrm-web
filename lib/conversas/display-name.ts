/**
 * Prioridade de exibição na lista de conversas:
 * lead.name → pushName (WhatsApp) → telefone formatado.
 */
export function resolveConversationDisplayName(params: {
  leadName?: string | null;
  pushName?: string | null;
  phoneLabel: string;
}): string {
  const lead = params.leadName?.trim();
  if (lead) return lead;
  const push = params.pushName?.trim();
  if (push) return push;
  return params.phoneLabel;
}

export function shouldFetchEvolutionContactName(params: {
  leadName?: string | null;
}): boolean {
  return !params.leadName?.trim();
}
