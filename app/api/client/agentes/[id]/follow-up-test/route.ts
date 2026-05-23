import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { followUpInteligenteFromMetadata } from "@/lib/server/follow-up-settings";
import { dryRunFollowUpEvaluation } from "@/lib/server/follow-up-evaluate";
import {
  loadConversationStateForJob,
  loadLeadForFollowUp,
  loadMessageTimestamps,
} from "@/lib/server/follow-up-jobs";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AgentFollowUpInteligente } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const agentId = params.id?.trim();
  if (!agentId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let body: {
    remoteJid?: string;
    leadId?: string | null;
    draft?: { followUpInteligente?: Partial<AgentFollowUpInteligente> };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const remoteJid = body.remoteJid?.trim();
  if (!remoteJid) {
    return NextResponse.json(
      { error: "Informe remoteJid (ex.: 5562999999999@s.whatsapp.net) de uma conversa para simular." },
      { status: 400 },
    );
  }

  const sb = createSupabaseServiceClient();
  const { data: agentRow } = await sb
    .from("tenant_agents")
    .select("metadata")
    .eq("tenant_id", session.tenantId)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (!agentRow) {
    return NextResponse.json({ error: "Agente não encontrado." }, { status: 404 });
  }

  const metadata =
    agentRow.metadata && typeof agentRow.metadata === "object"
      ? (agentRow.metadata as Record<string, unknown>)
      : {};

  const saved = followUpInteligenteFromMetadata(metadata);
  const draftFu = body.draft?.followUpInteligente;
  const settingsOverride: Partial<AgentFollowUpInteligente> | undefined = draftFu
    ? { ...saved, ...draftFu }
    : undefined;

  try {
    const result = await dryRunFollowUpEvaluation({
      sb,
      tenantId: session.tenantId,
      agentId,
      remoteJid,
      leadId: body.leadId ?? null,
      settingsOverride,
      buildContext: {
        tenantId: session.tenantId,
        agentId,
        remoteJid,
        leadId: body.leadId ?? null,
        loadLead: loadLeadForFollowUp,
        loadConversationState: loadConversationStateForJob,
        loadMessageTimestamps,
      },
    });

    return NextResponse.json({
      ok: true,
      simulation: true,
      wouldSend: result.decision.shouldSend,
      decision: result.decision,
      settings: result.settings,
      context: result.context,
      message: result.decision.shouldSend
        ? `Enviaria follow-up (${result.decision.followUpType}, prioridade ${result.decision.priority}).`
        : `Não enviaria: ${result.decision.skipReason ?? result.decision.reason}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "dry_run_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
