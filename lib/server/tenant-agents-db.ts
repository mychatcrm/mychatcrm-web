/**
 * Leitura de agentes do tenant a partir do Supabase (`tenant_agents`).
 *
 * Fonte única do mapeamento row → `Agent`: a lista (`GET /api/client/agentes`)
 * e o editor em página cheia (`/dashboard/agentes/[id]/editar`) precisam
 * enxergar exatamente o mesmo agente. Quando o editor lia o catálogo de
 * templates em memória, abrir um agente real cujo id coincidia com um template
 * mostrava o conteúdo de demonstração — e salvar sobrescrevia o agente do
 * cliente com esse conteúdo.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";
import { normalizeAgentCrmDestination } from "@/lib/agents/crm-destination";
import { normalizeAgentVoiceId, sanitizeAgentResponseSettings } from "@/lib/agents/response-settings";
import type { Agent } from "@/lib/types";
import { isAgentArchivedMetadata } from "@/lib/server/agent-management-validation";

export const BASE_AGENT_SELECT =
  "agent_id, display_name, system_prompt, model, active, metadata, created_at, updated_at, voice_id, response_mode, config_version, review_status, review_reasons, archived_at";
export const AGENT_SELECT_WITH_CRM = `${BASE_AGENT_SELECT}, crm_auto_move_enabled, crm_target_funnel_id, crm_target_column_id, crm_target_status`;

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_auto_move_enabled");
}

export function rowToAgent(row: Record<string, unknown>, tenantId: string): Agent {
  const responseSettings = sanitizeAgentResponseSettings({
    responseMode: row.response_mode,
    voiceId: row.voice_id,
  });
  const hasCrmColumns = Object.prototype.hasOwnProperty.call(row, "crm_auto_move_enabled");
  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Agent) : null;
  const crmDestination = normalizeAgentCrmDestination(
    hasCrmColumns
      ? {
          crmAutoMoveEnabled: row.crm_auto_move_enabled === true,
          crmTargetFunnelId: typeof row.crm_target_funnel_id === "string" ? row.crm_target_funnel_id : null,
          crmTargetColumnId: typeof row.crm_target_column_id === "string" ? row.crm_target_column_id : null,
          crmTargetStatus: typeof row.crm_target_status === "string" ? row.crm_target_status : null,
        }
      : (meta ?? {}),
  );

  // Agente salvo pelo painel: o objeto `Agent` inteiro está em metadata.
  if (meta) {
    return {
      ...meta,
      id: String(row.agent_id),
      clientId: tenantId,
      nome: String(row.display_name ?? meta.nome),
      status: (row.active as boolean) ? "ativo" : "pausado",
      atualizadoEm: String(row.updated_at ?? meta.atualizadoEm),
      configVersion: Number(row.config_version ?? meta.configVersion ?? 1),
      reviewStatus: row.review_status === "action_required" ? "action_required" : "ready",
      reviewReasons: Array.isArray(row.review_reasons)
        ? row.review_reasons.filter((reason): reason is string => typeof reason === "string")
        : [],
      voiceId:
        responseSettings.responseMode === "audio"
          ? responseSettings.voiceId ?? normalizeAgentVoiceId(meta.voiceId)
          : null,
      responseMode: responseSettings.responseMode,
      ...crmDestination,
    };
  }

  // Row antiga sem metadata: reconstrói a partir do template como esqueleto.
  const templates = buildTemplateAgentsForTenant(tenantId);
  const base = structuredClone(templates[0]!);
  return {
    ...base,
    id: String(row.agent_id),
    clientId: tenantId,
    nome: String(row.display_name ?? "Agente"),
    nomeProduto: "",
    instructionMode: "pro",
    simplePrompt: "",
    promptIdentidade: "",
    promptObjetivo: "",
    systemPrompt: String(row.system_prompt ?? base.systemPrompt),
    promptRegrasAdicionais: "",
    respostasProibidas: "",
    arquivosTreinamento: [],
    origens: [],
    fluxo: [],
    followUps: [],
    status: (row.active as boolean) ? "ativo" : "pausado",
    criadoEm: String(row.created_at ?? base.criadoEm),
    atualizadoEm: String(row.updated_at ?? base.atualizadoEm),
    configVersion: Number(row.config_version ?? 1),
    reviewStatus: row.review_status === "action_required" ? "action_required" : "ready",
    reviewReasons: Array.isArray(row.review_reasons)
      ? row.review_reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    voiceId: responseSettings.voiceId,
    responseMode: responseSettings.responseMode,
    ...crmDestination,
  };
}

/** Agente real do tenant, ou null quando não existe no banco. */
export async function loadTenantAgentById(tenantId: string, agentId: string): Promise<Agent | null> {
  const tenant = tenantId.trim();
  const agent = agentId.trim();
  if (!tenant || !agent) return null;

  const sb = createSupabaseServiceClient();
  const initial = await sb
    .from("tenant_agents")
    .select(AGENT_SELECT_WITH_CRM)
    .eq("tenant_id", tenant)
    .eq("agent_id", agent)
    .maybeSingle();
  let data: unknown = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const fallback = await sb
      .from("tenant_agents")
      .select(BASE_AGENT_SELECT)
      .eq("tenant_id", tenant)
      .eq("agent_id", agent)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error("[tenant-agents-db] load", error.code, error.message);
    return null;
  }
  if (!data) return null;
  if (
    (data as Record<string, unknown>).archived_at ||
    isAgentArchivedMetadata((data as Record<string, unknown>).metadata)
  ) return null;
  return rowToAgent(data as Record<string, unknown>, tenant);
}
