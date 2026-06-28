import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  evolutionFetchInstances,
  evolutionPing,
  evolutionSetWebhook,
  isEvolutionApiConfigured,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import {
  getSystemAgentInstanceName,
  getSystemAgentSession,
  getSystemWebhookDiagnostics,
  reconcileOrphanDeliveryEvents,
  reconcileUndeliveredNotifications,
} from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function maskWebhookUrl(url: string): string {
  return url.replace(/token=[^&]+/, "token=***");
}

async function buildDiagnosePayload(request: Request) {
  const instanceName = await getSystemAgentInstanceName();
  const agentSession = await getSystemAgentSession();
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ?? "";
  const publicBase = getPublicBaseUrlFromRequest(request);
  const expectedWebhookUrl = webhookSecret
    ? maskWebhookUrl(buildEvolutionWebhookUrl(publicBase, webhookSecret))
    : null;

  const [instancesRes, pingRes, webhookDiagnostics] = await Promise.all([
    instanceName ? evolutionFetchInstances(instanceName) : Promise.resolve(null),
    evolutionPing(),
    getSystemWebhookDiagnostics(),
  ]);

  const instanceInfo =
    instancesRes?.ok && instanceName ? pickEvolutionInstanceInfo(instancesRes.data, instanceName) : null;

  let recent: Array<{
    type: string;
    status: string;
    to_number: string;
    response_status: unknown;
    message_id: unknown;
    delivered_at: unknown;
    delivery_failed_at: unknown;
    created_at: string;
  }> = [];
  let lastDeliveredAt: string | null = null;
  let pendingCount = 0;
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from("system_notifications_log")
      .select("type, status, to_number, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    recent = (data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const deliveredAt = meta.delivered_at ?? null;
      if (row.status === "delivered" && typeof deliveredAt === "string" && !lastDeliveredAt) {
        lastDeliveredAt = deliveredAt;
      }
      if (row.status === "pending") pendingCount += 1;
      return {
        type: row.type,
        status: row.status,
        to_number: row.to_number,
        response_status: meta.evolution_response_status ?? null,
        message_id: meta.evolution_message_id ?? null,
        delivered_at: deliveredAt,
        delivery_failed_at: meta.delivery_failed_at ?? null,
        created_at: row.created_at,
      };
    });
  } catch {
    recent = [];
  }

  return {
    instanceName,
    session: {
      connectionState: agentSession.connectionState,
      ownerJid: agentSession.ownerJid,
      profileName: agentSession.profileName,
      authenticated: agentSession.authenticated,
      source: agentSession.source,
    },
    instanceInfo: instanceInfo
      ? {
          connectionStatus: instanceInfo.connectionStatus,
          ownerJid: instanceInfo.ownerJid,
          profileName: instanceInfo.profileName,
        }
      : null,
    fetchInstancesOk: instancesRes?.ok ?? false,
    fetchInstancesError: instancesRes && !instancesRes.ok ? instancesRes.error : null,
    infrastructure: {
      evolutionReachable: pingRes.reachable,
      evolutionPingError: pingRes.reachable ? null : pingRes.error,
      webhookSecretConfigured: Boolean(webhookSecret),
      expectedWebhookUrl,
      publicBaseUrl: publicBase || null,
    },
    webhook: webhookDiagnostics,
    delivery: {
      lastDeliveredAt,
      recentPendingCount: pendingCount,
      webhookUpdatesWorking:
        lastDeliveredAt !== null || webhookDiagnostics.lastMessagesUpdateAt !== null,
      pendingOrphanEventsCount: webhookDiagnostics.pendingOrphanEventsCount,
      lastOrphanReconcileAt: webhookDiagnostics.lastOrphanReconcileAt,
      lastOrphanReconcileApplied: webhookDiagnostics.lastOrphanReconcileApplied,
      lastOrphanReconcileRemaining: webhookDiagnostics.lastOrphanReconcileRemaining,
      webhookBottleneck:
        webhookDiagnostics.lastMessagesUpdateAt !== null &&
        lastDeliveredAt === null &&
        webhookDiagnostics.pendingOrphanEventsCount > 0,
    },
    recent,
  };
}

/**
 * Diagnóstico avançado do agente do sistema.
 * GET: estado da sessão, webhook esperado, entregas recentes.
 * POST: re-aplica webhook na instância Evolution (action: reapply_webhook).
 */
export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  await reconcileUndeliveredNotifications(60);
  await reconcileOrphanDeliveryEvents();

  return NextResponse.json(await buildDiagnosePayload(request));
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === "reconcile_orphans") {
    const orphanResult = await reconcileOrphanDeliveryEvents();
    const timedOut = await reconcileUndeliveredNotifications(60);
    const payload = await buildDiagnosePayload(request);
    return NextResponse.json({
      ...payload,
      reconcile: {
        orphansApplied: orphanResult.applied,
        orphansRemaining: orphanResult.remaining,
        timedOut,
      },
    });
  }

  if (body.action !== "reapply_webhook") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "EVOLUTION_WEBHOOK_SECRET não configurado." }, { status: 503 });
  }

  const instanceName = await getSystemAgentInstanceName();
  if (!instanceName) {
    return NextResponse.json({ error: "Instância do sistema não configurada." }, { status: 400 });
  }

  const publicBase = getPublicBaseUrlFromRequest(request);
  const webhookUrl = buildEvolutionWebhookUrl(publicBase, webhookSecret);
  const setResult = await evolutionSetWebhook({ instanceName, url: webhookUrl });

  const payload = await buildDiagnosePayload(request);
  return NextResponse.json({
    ...payload,
    webhookReapply: {
      ok: setResult.ok,
      error: setResult.ok ? null : setResult.error,
      url: maskWebhookUrl(webhookUrl),
    },
  });
}
