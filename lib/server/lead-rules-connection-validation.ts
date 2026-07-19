/**
 * Validação da conexão WhatsApp em regras meta_form (Evolution ou Cloud + template).
 * Usada por POST/PUT /api/client/lead-rules.
 */
import "server-only";
import { NextResponse } from "next/server";
import { listWhatsAppMessageTemplates } from "@/lib/integrations/whatsapp-cloud";
import { stringArray } from "@/lib/server/meta-form-authorization";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

const META_AUTOMATION_DISTRIBUTION_TYPES = new Set(["automation_agent", "specific_agents", "round_robin"]);

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function validateMetaAutomationConnection(
  sb: ServiceClient,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (
    payload.source !== "meta_form" ||
    !META_AUTOMATION_DISTRIBUTION_TYPES.has(String(payload.distribution_type)) ||
    stringArray(payload.agent_ids).length === 0
  ) {
    return null;
  }

  const connectionId = typeof payload.connection_id === "string" ? payload.connection_id.trim() : "";
  if (!connectionId) {
    return NextResponse.json(
      { error: "Selecione a conexão WhatsApp que este formulário pode usar para o primeiro atendimento." },
      { status: 400 },
    );
  }

  const transportRaw = typeof payload.transport === "string" ? payload.transport.trim() : "";
  const transport = transportRaw === "cloud_api" ? "cloud_api" : "evolution";

  if (transport === "cloud_api") {
    const cloud = await lookupWhatsAppCloudConnectionByPhoneNumberId(connectionId);
    if (!cloud || cloud.tenant_id !== tenantId || !cloud.active) {
      return NextResponse.json(
        {
          error:
            "A conexão Cloud API desta regra não está disponível. Conecte o número em Integrações → API Meta e selecione-o de novo.",
        },
        { status: 400 },
      );
    }
    if (!cloud.waba_id?.trim() || !cloud.access_token?.trim()) {
      return NextResponse.json(
        { error: "A conexão Cloud API está incompleta (WABA ou token). Reconecte o número em Integrações." },
        { status: 400 },
      );
    }

    const templateName =
      typeof payload.meta_template_name === "string" ? payload.meta_template_name.trim() : "";
    if (!templateName) {
      return NextResponse.json(
        {
          error:
            "Escolha um template Meta aprovado para o primeiro WhatsApp desta regra (obrigatório na Cloud API).",
        },
        { status: 400 },
      );
    }

    const templates = await listWhatsAppMessageTemplates({
      wabaId: cloud.waba_id,
      accessToken: cloud.access_token,
    });
    const template = templates.find((t) => t.name === templateName);
    if (!template || template.status !== "APPROVED") {
      return NextResponse.json(
        {
          error:
            "Esse template não está aprovado na Meta (ou não existe nesta conta). Escolha outro modelo APPROVED.",
        },
        { status: 400 },
      );
    }
    return null;
  }

  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      {
        error:
          "A conexão salva nesta regra não está mais disponível. Atualize a lista e selecione a conexão WhatsApp atual.",
      },
      { status: 400 },
    );
  }
  return null;
}
