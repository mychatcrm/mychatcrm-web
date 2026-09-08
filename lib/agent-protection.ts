/** Operator-facing copy only; never added to an agent prompt or lead reply. */
export function agentProtectionDescription(code: string): { expected: boolean; explanation: string; nextStep: string } {
  if (/human|takeover/.test(code)) return { expected: true, explanation: "O atendimento humano está ativo; a automação foi impedida de interferir.", nextStep: "Devolver para automação somente quando o responsável desejar." };
  if (/disabled|paused|kill_switch|configuration_changed/.test(code)) return { expected: true, explanation: "O recurso está desligado ou sua configuração foi alterada.", nextStep: "Conferir a configuração do agente. Não ligar automaticamente." };
  if (/generation_stale|sequence|superseded|duplicate|already_sent/.test(code)) return { expected: true, explanation: "Uma mensagem mais recente ou uma execução anterior tornou esta tentativa desnecessária.", nextStep: "Conferir a próxima resposta e o histórico; não reenviar a tentativa antiga." };
  if (/rule|journey|connection|authorization|epoch|transport/.test(code)) return { expected: false, explanation: "Não foi possível confirmar que este agente tem permissão para atuar nesta conversa e conexão.", nextStep: "Conferir regra, jornada, conexão e atendimento humano. Ausência intencional de regra não é defeito." };
  if (/agenda|datetime|timezone|slot|availability/.test(code)) return { expected: false, explanation: "Uma validação de agenda impediu uma operação ou resposta não confirmada.", nextStep: "Conferir pedido, fuso, disponibilidade e resultado da agenda, preservando compromissos confirmados." };
  if (/language|localiz/.test(code)) return { expected: false, explanation: "O sistema não confirmou uma resposta segura no idioma da conversa.", nextStep: "Investigar o idioma e a geração, sem enviar uma tradução improvisada." };
  return { expected: false, explanation: "Uma proteção interrompeu esta tentativa para evitar uma ação sem confirmação segura.", nextStep: "Abrir o histórico desta operação e investigar o código técnico. Não desativar a proteção indiscriminadamente." };
}

export function safeProtectionCode(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_:.-]{1,160}$/.test(value)
    ? value : "agent_protection_unknown";
}
