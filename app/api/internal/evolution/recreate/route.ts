import { NextResponse } from "next/server";
import {
  extractPairingCodeFromConnectPayload,
  normalizeInstanceConnectToQrDataUrl,
} from "@/lib/integrations/evolution-connect-qr";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  CLIENT_EVOLUTION_INSTANCE_SETTINGS,
  evolutionCreateInstance,
  evolutionEnsureClientInstanceSettings,
  evolutionEnsureWebhook,
  evolutionFetchInstances,
  evolutionInstanceConnect,
} from "@/lib/integrations/evolution-api";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RecreateBody = { connectionId?: string };

/**
 * Recovery-only endpoint for a logical QR connection whose remote Evolution
 * instance was removed. It never accepts an instance name from the caller:
 * tenant, slot and instance identity are loaded from the private database row.
 */
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: RecreateBody = {};
  try {
    body = (await request.json()) as RecreateBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  if (!connectionId) return NextResponse.json({ error: "connectionId obrigatório" }, { status: 400 });

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return NextResponse.json({ error: "Configuração indisponível" }, { status: 503 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("id,tenant_id,slot_index,instance_name,connection_state,wa_jid")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) {
    console.error("[evolution-recreate] connection_lookup_failed", { connectionId, error: error.message });
    return NextResponse.json({ error: "Falha ao localizar conexão" }, { status: 500 });
  }
  if (!data?.instance_name) return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });

  const instanceName = String(data.instance_name);
  const inventory = await evolutionFetchInstances(instanceName);
  const instanceMissing = !inventory.ok && inventory.status === 404;
  if (!inventory.ok && !instanceMissing) {
    let evolutionHost: string | null = null;
    try {
      evolutionHost = new URL(process.env.EVOLUTION_API_BASE_URL ?? "").host || null;
    } catch {
      evolutionHost = null;
    }
    console.error("[evolution-recreate] inventory_failed", {
      connectionId,
      status: inventory.status,
      configured: Boolean(process.env.EVOLUTION_API_BASE_URL && process.env.EVOLUTION_API_KEY),
      evolutionHost,
      error: inventory.error,
    });
    return NextResponse.json(
      {
        error: "Evolution indisponível",
        diagnostic: {
          status: inventory.status,
          configured: Boolean(process.env.EVOLUTION_API_BASE_URL && process.env.EVOLUTION_API_KEY),
          evolutionHost,
        },
      },
      { status: 502 },
    );
  }
  const inventoryItems = inventory.ok ? inventory.data : [];

  let recreated = false;
  if (instanceMissing || !inventoryItems.some((item) => item.name === instanceName)) {
    const webhookUrl = buildEvolutionWebhookUrl(getPublicBaseUrlFromRequest(request), webhookSecret);
    const created = await evolutionCreateInstance({
      instanceName,
      webhookUrl,
      settings: { ...CLIENT_EVOLUTION_INSTANCE_SETTINGS },
    });
    if (!created.ok) {
      console.error("[evolution-recreate] create_failed", { connectionId, status: created.status });
      return NextResponse.json({ error: "Falha ao recriar instância", status: created.status }, { status: 502 });
    }
    recreated = true;
  }

  const webhookUrl = buildEvolutionWebhookUrl(getPublicBaseUrlFromRequest(request), webhookSecret);
  const [settings, webhook] = await Promise.all([
    evolutionEnsureClientInstanceSettings(instanceName),
    evolutionEnsureWebhook({ instanceName, url: webhookUrl }),
  ]);
  if (!webhook.healthy && !webhook.reapplyOk) {
    return NextResponse.json({ error: "Webhook não confirmado" }, { status: 502 });
  }

  const connect = await evolutionInstanceConnect(instanceName);
  if (!connect.ok) {
    return NextResponse.json({ error: "Falha ao gerar pareamento", status: connect.status }, { status: 502 });
  }
  const qrDataUrl = normalizeInstanceConnectToQrDataUrl(connect.data);
  const pairingCode = extractPairingCodeFromConnectPayload(connect.data);
  if (!qrDataUrl && !pairingCode) {
    return NextResponse.json({ error: "Evolution não devolveu QR nem código" }, { status: 502 });
  }

  await sb
    .from("tenant_evolution_instances")
    .update({ connection_state: "connecting", updated_at: new Date().toISOString() })
    .eq("id", connectionId);

  console.info("[evolution-recreate] pairing_ready", {
    connectionId,
    tenantId: data.tenant_id,
    slotIndex: data.slot_index,
    recreated,
    settingsVerified: settings.verified,
    webhookVerified: webhook.healthy || webhook.reapplyOk,
  });
  return NextResponse.json(
    { ok: true, recreated, instanceName, qrDataUrl, pairingCode },
    { headers: { "Cache-Control": "no-store" } },
  );
}
