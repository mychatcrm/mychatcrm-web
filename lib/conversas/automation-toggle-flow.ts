export type AutomationSnapshot = {
  enabled: boolean;
  human_paused: boolean;
  paused_by: string | null;
  paused_reason: string | null;
  conversation_mode?: "automation" | "waiting_human" | "human";
  can_human_send?: boolean;
  assigned_human_name?: string | null;
  handoff_suggested?: boolean;
};

export type AutomationConfirmIntent = "pause" | "resume" | null;

export function resolveAutomationConfirmIntent(currentEnabled: boolean): Exclude<AutomationConfirmIntent, null> {
  return currentEnabled ? "pause" : "resume";
}

export function getAutomationConfirmCopy(intent: Exclude<AutomationConfirmIntent, null>) {
  if (intent === "resume") {
    return {
      title: "Deseja reativar a automação deste contato?",
      description: "O agente voltará a responder automaticamente esta conversa.",
      confirmLabel: "Reativar automação",
      confirmColor: "#00a884",
      busyLabel: "Reativando…",
    };
  }
  return {
    title: "Deseja realmente pausar a automação deste contato?",
    description: "O agente deixará de responder automaticamente esta conversa até ser reativado.",
    confirmLabel: "Pausar automação",
    confirmColor: "#c47a24",
    busyLabel: "Pausando…",
  };
}

export function nextAutomationEnabled(intent: Exclude<AutomationConfirmIntent, null>): boolean {
  return intent === "resume";
}

export function buildOptimisticAutomation(enabled: boolean): AutomationSnapshot {
  return {
    enabled,
    human_paused: !enabled,
    paused_by: enabled ? null : "human_manual",
    paused_reason: enabled ? null : "manual_toggle",
    conversation_mode: enabled ? "automation" : "human",
    can_human_send: !enabled,
  };
}

export function buildRollbackAutomation(
  previous: AutomationSnapshot,
  stored?: Partial<AutomationSnapshot> | null,
): AutomationSnapshot {
  return {
    ...previous,
    paused_by: stored?.paused_by ?? previous.paused_by,
    paused_reason: stored?.paused_reason ?? previous.paused_reason,
  };
}

export async function runAutomationToggleCommit(params: {
  remoteJid: string;
  nextEnabled: boolean;
  previous: AutomationSnapshot;
  toggleApi: (remoteJid: string, enabled: boolean) => Promise<AutomationSnapshot>;
}): Promise<
  | { ok: true; automation: AutomationSnapshot }
  | { ok: false; rollback: AutomationSnapshot; error: string }
> {
  try {
    const automation = await params.toggleApi(params.remoteJid, params.nextEnabled);
    return { ok: true, automation };
  } catch (error) {
    return {
      ok: false,
      rollback: buildRollbackAutomation(params.previous),
      error: error instanceof Error ? error.message : "Não foi possível alterar a automação.",
    };
  }
}
