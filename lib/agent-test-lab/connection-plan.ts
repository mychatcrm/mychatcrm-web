/**
 * Pure decisions for the laboratory's two WhatsApp lines: the tester line the
 * owner writes from, and the line the isolated copy answers on.
 *
 * The laboratory keeps one live connection per line, so choosing the other
 * provider always means disconnecting the current one first. That is a real
 * consequence, so it is stated to the owner and confirmed before anything is
 * removed, instead of being hidden behind a disabled button.
 */
export type LabProvider = "evolution" | "meta_cloud";
export type LabRole = "tester" | "copy";
export type LabConnectionView = { provider: LabProvider; state: string; number: string | null } | null;

export const LAB_PROVIDER_LABELS: Record<LabProvider, string> = {
  evolution: "QR Code · Evolution",
  meta_cloud: "API Oficial Meta",
};
const ROLE_LABELS: Record<LabRole, string> = {
  tester: "O WhatsApp testador",
  copy: "O WhatsApp da cópia isolada",
};
const CONNECTION_STATE_LABELS: Record<string, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura do QR",
  provisioning: "Preparando a conexão",
  action_required: "Conexão incompleta na Meta",
  conflict: "Número já usado por outra conexão",
  absent: "Instância não encontrada",
  disconnected: "Desconectado",
};

export function labConnectionStateLabel(state: string | null | undefined): string {
  return state ? CONNECTION_STATE_LABELS[state] ?? state : "Não conectado";
}
export function isLabConnectionReady(connection: LabConnectionView): boolean {
  return connection?.state === "open";
}

export type LabSwitchPlan =
  /** Nothing is connected on this line: go straight to the chosen provider. */
  | { kind: "connect"; role: LabRole; target: LabProvider }
  /** Already on the chosen provider: offer to finish or repair it, never a swap. */
  | { kind: "already"; role: LabRole; target: LabProvider }
  /** The other provider is live: state the consequence and ask before removing it. */
  | { kind: "switch"; role: LabRole; target: LabProvider; from: LabProvider; confirmMessage: string }
  /** A test is running on this line: explain instead of failing halfway through. */
  | { kind: "blocked"; role: LabRole; target: LabProvider; reason: string };

export function planLabProviderSwitch(input: {
  role: LabRole;
  current: LabConnectionView;
  target: LabProvider;
  activeRuns: number;
}): LabSwitchPlan {
  const { role, current, target } = input;
  if (current && current.provider === target) return { kind: "already", role, target };
  if (input.activeRuns > 0) {
    return { kind: "blocked", role, target,
      reason: `${input.activeRuns} execução(ões) ainda aberta(s). Pare os testes em andamento antes de trocar a conexão desta linha.` };
  }
  if (!current) return { kind: "connect", role, target };
  return { kind: "switch", role, target, from: current.provider,
    confirmMessage: `${ROLE_LABELS[role]} está conectado por ${LAB_PROVIDER_LABELS[current.provider]}. `
      + `Deseja desconectá-lo e conectar por ${LAB_PROVIDER_LABELS[target]}?` };
}

export type LabChecklistItem = {
  code: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Where the owner has to click to resolve it. Null when nothing is pending. */
  action: { label: string; anchor: string } | null;
};

export function buildLabChecklist(input: {
  internalOnly: boolean;
  tester: LabConnectionView;
  targetKind: "copy" | "original";
  copy: LabConnectionView;
  agentSelected: boolean;
  numberSelected: boolean;
  ruleSelected: boolean;
  expectsSilence: boolean;
  numbersDistinct: boolean;
  internalApproved: boolean;
  originalConfirmed: boolean;
}): LabChecklistItem[] {
  const items: LabChecklistItem[] = [];
  const usesCopy = input.targetKind === "copy";
  items.push({
    code: "tester_connected", label: "Testador conectado",
    ok: isLabConnectionReady(input.tester),
    detail: isLabConnectionReady(input.tester)
      ? `Conectado por ${LAB_PROVIDER_LABELS[input.tester!.provider]}${input.tester!.number ? ` · ${input.tester!.number}` : ""}.`
      : "Escolha como conectar o WhatsApp que você vai usar para escrever no teste.",
    action: isLabConnectionReady(input.tester) ? null : { label: "Conectar testador", anchor: "lab-passo-conexao" },
  });
  if (input.internalOnly) {
    items.push({
      code: "internal_approved", label: "Testes internos aprovados",
      ok: input.internalApproved,
      detail: input.internalApproved
        ? "A última suíte interna passou nesta versão."
        : "Rode a suíte interna nesta versão antes de confiar em um teste real.",
      action: input.internalApproved ? null : { label: "Rodar suíte interna", anchor: "lab-passo-iniciar" },
    });
    return items;
  }
  items.push({
    code: "agent_selected", label: "Agente selecionado",
    ok: input.agentSelected,
    detail: input.agentSelected ? "Cliente e agente escolhidos." : "Escolha o cliente e o agente que serão testados.",
    action: input.agentSelected ? null : { label: "Escolher agente", anchor: "lab-passo-agente" },
  });
  items.push({
    code: "number_selected", label: "Número atendido selecionado",
    ok: input.numberSelected,
    detail: input.numberSelected
      ? usesCopy
        ? `A cópia atende por ${LAB_PROVIDER_LABELS[input.copy!.provider]}${input.copy!.number ? ` · ${input.copy!.number}` : ""}.`
        : "Conexão do agente original escolhida."
      : usesCopy
        ? "Conecte a linha que a cópia isolada vai atender."
        : "Escolha a conexão e o número que o agente original atende.",
    action: input.numberSelected ? null : { label: "Escolher número atendido", anchor: "lab-passo-numero" },
  });
  items.push({
    code: "rule_found", label: "Regra encontrada",
    ok: input.ruleSelected || input.expectsSilence,
    detail: input.ruleSelected
      ? "A regra de entrada que leva a conversa até o agente está selecionada."
      : input.expectsSilence
        ? "Sem regra, por opção: este teste espera silêncio."
        : "Sem regra de entrada a conversa não chega ao agente. Escolha uma regra ou marque que espera silêncio.",
    action: input.ruleSelected || input.expectsSilence ? null : { label: "Escolher regra", anchor: "lab-passo-numero" },
  });
  items.push({
    code: "numbers_distinct", label: "Números diferentes",
    ok: input.numbersDistinct,
    detail: input.numbersDistinct
      ? "O número testador e o número atendido são diferentes."
      : "O testador e o número atendido são o mesmo. Use uma linha dedicada para cada papel.",
    action: input.numbersDistinct ? null : { label: "Rever as conexões", anchor: "lab-passo-conexao" },
  });
  items.push({
    code: "internal_approved", label: "Testes internos aprovados",
    ok: input.internalApproved,
    detail: input.internalApproved
      ? "A última suíte interna passou nesta versão."
      : "Rode a suíte interna nesta versão antes de gastar uma conversa real.",
    action: input.internalApproved ? null : { label: "Rodar suíte interna", anchor: "lab-passo-modo" },
  });
  if (!usesCopy) {
    items.push({
      code: "original_confirmed", label: "Efeitos reais autorizados",
      ok: input.originalConfirmed,
      detail: input.originalConfirmed
        ? "Você autorizou os efeitos desta execução no agente original."
        : "O agente original produz efeitos reais. Marque os efeitos permitidos e confirme.",
      action: input.originalConfirmed ? null : { label: "Autorizar efeitos", anchor: "lab-passo-agente" },
    });
  }
  const ready = items.every(item => item.ok);
  items.push({
    code: "ready", label: "Pronto para iniciar",
    ok: ready,
    detail: ready ? "Tudo verificado. Você pode iniciar a conversa." : "Resolva os itens acima para liberar o início.",
    action: ready ? { label: "Iniciar conversa", anchor: "lab-passo-iniciar" } : null,
  });
  return items;
}

/** The single next thing to do, for the "O que faço agora?" area. */
export function nextLabStep(items: LabChecklistItem[]): LabChecklistItem | null {
  return items.find(item => !item.ok) ?? items.find(item => item.code === "ready") ?? null;
}
