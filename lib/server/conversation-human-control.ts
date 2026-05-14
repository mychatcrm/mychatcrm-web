import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { syncAutomationMode } from "@/lib/server/conversation-operation";
import {
  getConversationState,
  type ConversationState,
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
    await syncAutomationMode({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      enabled: false,
      leadId: params.leadId,
      agentId: params.agentId,
    });
    return "paused";
  }

  if (resumeCommand && text === resumeCommand) {
    await syncAutomationMode({
      sb,
      tenantId: params.tenantId,
      remoteJid: params.remoteJid,
      enabled: true,
      leadId: params.leadId,
      agentId: params.agentId,
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
  const sb = params.sb ?? createSupabaseServiceClient();
  await syncAutomationMode({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
    enabled: params.enabled,
    leadId: params.leadId,
    agentId: params.agentId,
  });
  return getConversationState({
    sb,
    tenantId: params.tenantId,
    remoteJid: params.remoteJid,
  });
}

export function isConversationAutomationEnabled(state: ConversationState | null | undefined): boolean {
  return state ? !state.humanPaused : true;
}
