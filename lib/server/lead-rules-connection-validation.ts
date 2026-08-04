/**
 * Validação da conexão WhatsApp em regras meta_form (Evolution ou Cloud + template).
 * Usada por POST/PUT /api/client/lead-rules.
 */
import "server-only";
import { NextResponse } from "next/server";
import { isMetaAutomationDistributionType } from "@/lib/meta-lead-automation";
import { listWhatsAppMessageTemplates } from "@/lib/integrations/whatsapp-cloud";
import { stringArray } from "@/lib/server/meta-form-authorization";
import {
  MetaGraphRequestError,
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";
import { ensureTenantPageLeadgenWebhookSubscription } from "@/lib/server/meta-page-webhook-subscribe";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type MetaFormsProbeResponse = {
  data?: Array<{ id?: string; status?: string }>;
  paging?: { next?: string };
};

function metaRuleGraphError(error: unknown, context: "forms" | "leads"): NextResponse {
  const code = metaGraphErrorCode(error);
  const retryable = error instanceof MetaGraphRequestError && error.retryable;
  const permissionDenied = code === "permission_denied";
  return NextResponse.json(
    {
      error: permissionDenied
        ? context === "leads"
          ? "A Meta não liberou o MyChatCRM no Acesso a Leads desta Página. No portfólio empresarial, atribua o CRM MyChatCRM à Página."
          : "A Meta não permitiu consultar os formulários desta Página. Reconecte a conta e confirme o acesso à Página."
        : retryable
          ? "A Meta está temporariamente indisponível. Tente salvar a regra novamente em alguns instantes."
          : "Não foi possível validar os formulários desta Página na Meta.",
      code:
        permissionDenied && context === "leads"
          ? "lead_access_denied"
          : permissionDenied
            ? "forms_access_denied"
            : code,
    },
    { status: retryable ? 503 : 409 },
  );
}

export async function validateMetaAutomationConnection(
  sb: ServiceClient,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (payload.source !== "meta_form") return null;
  const agentIds = stringArray(payload.agent_ids);
  const employeeIds = stringArray(payload.employee_ids);
  if (isMetaAutomationDistributionType(payload.distribution_type) && agentIds.length === 0) {
    return NextResponse.json(
      { error: "Selecione um agente de IA ativo para esta regra." },
      { status: 400 },
    );
  }
  if (
    payload.distribution_type === "agent_plus_seller" &&
    (agentIds.length !== 1 || employeeIds.length !== 1)
  ) {
    return NextResponse.json(
      { error: "Selecione exatamente um agente de IA e um vendedor para esta regra." },
      { status: 400 },
    );
  }
  const automationEnabled =
    isMetaAutomationDistributionType(payload.distribution_type) &&
    agentIds.length > 0;

  const pageId = typeof payload.page_id === "string" ? payload.page_id.trim() : "";
  if (!pageId) {
    return NextResponse.json(
      { error: "Selecione a Página Meta exata desta regra." },
      { status: 400 },
    );
  }

  const { data: metaPage, error: metaPageError } = await sb
    .from("meta_connections")
    .select(
      "page_access_token, health_status, health_code, health_message, subscribed_fields, last_verified_at",
    )
    .eq("tenant_id", tenantId)
    .eq("page_id", pageId)
    .maybeSingle();
  if (metaPageError) {
    return NextResponse.json(
      { error: "Não foi possível verificar a saúde da conexão Meta." },
      { status: 503 },
    );
  }
  if (!metaPage) {
    return NextResponse.json(
      { error: "A Página Meta desta regra não pertence a esta conta." },
      { status: 400 },
    );
  }
  const operational =
    metaPage.health_status === "ready" ||
    metaPage.health_status === "degraded" ||
    metaPage.health_status === "legacy_grace";
  if (!operational) {
    return NextResponse.json(
      {
        error:
          metaPage.health_message ??
          "A conexão Meta ainda não foi validada. Verifique ou reconecte a Página em Integrações.",
        code: metaPage.health_code ?? "meta_connection_not_ready",
      },
      { status: 409 },
    );
  }
  const subscribedFields = Array.isArray(metaPage.subscribed_fields)
    ? metaPage.subscribed_fields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];
  const lastVerifiedAt =
    typeof metaPage.last_verified_at === "string"
      ? Date.parse(metaPage.last_verified_at)
      : Number.NaN;
  const cachedSubscriptionIsFresh =
    subscribedFields.some((field) => field.toLowerCase() === "leadgen") &&
    Number.isFinite(lastVerifiedAt) &&
    lastVerifiedAt >= Date.now() - 24 * 60 * 60_000;

  if (!cachedSubscriptionIsFresh) {
    const subscription = await ensureTenantPageLeadgenWebhookSubscription({
      sb,
      tenantId,
      pageId,
    });
    if (!subscription.ok) {
      return NextResponse.json(
        {
          error:
            "A Meta não confirmou a assinatura de leads desta Página. Verifique a conexão em Integrações antes de ativar a regra.",
          code: subscription.error ?? "meta_leadgen_subscription_failed",
        },
        { status: 409 },
      );
    }
  }

  const useAllForms = payload.use_all_forms === true;
  const includedFormIds = stringArray(payload.included_form_ids);
  if (!useAllForms && includedFormIds.length === 0) {
    return NextResponse.json(
      { error: "Selecione ao menos um formulário Meta para esta regra." },
      { status: 400 },
    );
  }

  const pageFormIds = new Set<string>();
  const activeFormIds = new Set<string>();
  let nextUrl: string | undefined = `/${encodeURIComponent(pageId)}/leadgen_forms`;
  let firstPage = true;
  try {
    for (let page = 0; nextUrl && page < 5; page += 1) {
      const response: MetaFormsProbeResponse =
        await metaGraphRequest<MetaFormsProbeResponse>(nextUrl, {
        accessToken: String(metaPage.page_access_token),
        searchParams: firstPage
          ? { fields: "id,status", limit: 100 }
          : undefined,
        });
      firstPage = false;
      for (const form of response.data ?? []) {
        if (!form.id) continue;
        pageFormIds.add(form.id);
        if (form.status === "ACTIVE") activeFormIds.add(form.id);
      }
      nextUrl = response.paging?.next;
    }
  } catch (error) {
    return metaRuleGraphError(error, "forms");
  }

  const missingForms = includedFormIds.filter((formId) => !pageFormIds.has(formId));
  if (missingForms.length > 0) {
    return NextResponse.json(
      {
        error:
          "Um ou mais formulários selecionados não estão ativos ou não pertencem a esta Página. Atualize a lista e selecione-os novamente.",
        code: "meta_form_not_available",
      },
      { status: 409 },
    );
  }

  // A Meta mantém formulários arquivados no catálogo da Página. Regras antigas
  // podem, portanto, carregar IDs que eram válidos quando foram salvos. Ao
  // editar a regra, preserve os formulários ainda ativos e descarte somente os
  // arquivados da mesma Página; um ID que não pertence à Página continua sendo
  // bloqueado acima. Isso evita que um formulário legado impeça a inclusão de
  // um formulário novo e ativo.
  const activeIncludedFormIds = includedFormIds.filter((formId) => activeFormIds.has(formId));
  if (!useAllForms) {
    if (activeIncludedFormIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Os formulários selecionados estão arquivados na Meta. Atualize a lista e selecione ao menos um formulário ativo.",
          code: "meta_active_form_missing",
        },
        { status: 409 },
      );
    }
    payload.included_form_ids = activeIncludedFormIds;
  }

  const leadProbeFormId = activeIncludedFormIds[0] ?? activeFormIds.values().next().value;
  if (typeof leadProbeFormId !== "string" || !leadProbeFormId) {
    return NextResponse.json(
      {
        error: "Nenhum formulário ativo foi encontrado nesta Página.",
        code: "meta_active_form_missing",
      },
      { status: 409 },
    );
  }
  try {
    await metaGraphRequest(`/${encodeURIComponent(leadProbeFormId)}/leads`, {
      accessToken: String(metaPage.page_access_token),
      searchParams: { fields: "id", limit: 1 },
    });
  } catch (error) {
    return metaRuleGraphError(error, "leads");
  }

  // CRM-only and human distribution rules still require an owned, healthy
  // Meta Page with live form/lead access, but they do not require WhatsApp.
  if (!automationEnabled) return null;

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
