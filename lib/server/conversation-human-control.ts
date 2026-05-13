import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { upsertConversationState } from "@/lib/server/conversation-memory";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function normalizeCommand(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

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
  const agentId = normalizeCommand(params.agentId);
  if (!text || !agentId || agentId === "human") return "none";

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
