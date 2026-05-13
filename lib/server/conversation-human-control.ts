import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  type ConversationState,
  upsertConversationState,
} from "@/lib/server/conversation-memory";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function normalizeCommand(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

/**
 * Comandos textuais opcionais (comandoPausaConversa / comandoRetomaConversa).
 * Só aplica match exato, case-insensitive, quando o campo estiver preenchido.
 * O controle principal de automação é o toggle visual em /dashboard/conversas.
 */
export async function applyHumanConversationCommand(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  agentId?: string | null;
  text?: string | null;
  leadId?: string | null;
  occurredAt?: string | null;
}): Promise<"paused" | "resumed" | "none"> {
  const text = normalizeCommand(params.text);
  if (!text || !params.agentId || params.agentId === "human") return "none";

  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") return "none";
  const metadata = (data as { metadata?: unknown }).metadata;
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const pauseCommand = normalizeCommand(meta.comandoPausaConversa);
  const resumeCommand = normalizeCommand(meta.comandoRetomaConversa);

  if (pauseCommand && text === pauseCommand) {
    await upsertConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId: params.agentId,
      humanPaused: true,
      pausedBy: "human_command",
      pausedReason: "manual_pause_command",
      lastMessageAt: params.occurredAt ?? new Date().toISOString(),
    });
    return "paused";
  }

  if (resumeCommand && text === resumeCommand) {
    await upsertConversationState({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      leadId: params.leadId,
      agentId: params.agentId,
      humanPaused: false,
      pausedBy: null,
      pausedReason: null,
      handoffSuggested: false,
      handoffReason: null,
      lastMessageAt: params.occurredAt ?? new Date().toISOString(),
    });
    return "resumed";
  }

  return "none";
}

/** Liga/desliga automação do agente para uma conversa (toggle do painel). */
export async function setConversationAutomationEnabled(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  enabled: boolean;
  leadId?: string | null;
  agentId?: string | null;
  occurredAt?: string | null;
}): Promise<ConversationState | null> {
  const patch: Parameters<typeof upsertConversationState>[0] = {
    sb: params.sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    leadId: params.leadId,
    agentId: params.agentId,
    humanPaused: !params.enabled,
    pausedBy: params.enabled ? null : "human_manual",
    pausedReason: params.enabled ? null : "manual_toggle",
    lastMessageAt: params.occurredAt ?? new Date().toISOString(),
  };
  if (params.enabled) {
    patch.handoffSuggested = false;
    patch.handoffReason = null;
  }
  return upsertConversationState(patch);
}

export function isConversationAutomationEnabled(state: ConversationState | null | undefined): boolean {
  return state ? !state.humanPaused : true;
}
