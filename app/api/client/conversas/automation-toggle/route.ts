/**
 * POST /api/client/conversas/automation-toggle
 * Liga ou desliga o agente/automação para uma conversa específica.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  isConversationAutomationEnabled,
  setConversationAutomationEnabled,
} from "@/lib/server/conversation-human-control";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { remoteJid?: string; enabled?: boolean };
  try {
    body = (await request.json()) as { remoteJid?: string; enabled?: boolean };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const remoteJid = body.remoteJid?.trim();
  if (!remoteJid) {
    return NextResponse.json({ error: "remoteJid é obrigatório" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled deve ser boolean" }, { status: 400 });
  }

  const instance = await getEvolutionInstanceByTenantId(session.tenantId);
  const sb = createSupabaseServiceClient();
  const state = await setConversationAutomationEnabled({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    enabled: body.enabled,
    agentId: instance?.default_agent_id ?? null,
  });

  return NextResponse.json({
    ok: true,
    automation: {
      enabled: isConversationAutomationEnabled(state),
      human_paused: state?.humanPaused ?? !body.enabled,
      paused_by: state?.pausedBy ?? (body.enabled ? null : "human_manual"),
      paused_reason: state?.pausedReason ?? (body.enabled ? null : "manual_toggle"),
    },
  });
}
