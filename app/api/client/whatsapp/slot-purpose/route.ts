/**
 * PATCH /api/client/whatsapp/slot-purpose
 *
 * Trava (ou destrava) a finalidade de uma linha WhatsApp: formulários Meta ou
 * WhatsApp direto. Depois de travada, o wizard de regras só oferece essa linha
 * para regras da finalidade certa e a API recusa a combinação errada — é o que
 * impede o mesmo número de atender formulário e contato espontâneo ao mesmo
 * tempo.
 *
 * Travar é recusado quando já existe regra da finalidade oposta apontando para
 * esta linha: senão a regra ficaria órfã, ativa no painel mas incapaz de ser
 * salva de novo. Destravar (`purpose: null`) passa sempre — voltar para «livre»
 * é a saída de emergência que restaura o comportamento anterior na hora.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { setSlotPurpose, type SlotPurpose } from "@/lib/server/whatsapp-slot-provider";
import { purposeForRuleSource, slotPurposeLabel } from "@/lib/server/lead-rules-line-purpose";

export const dynamic = "force-dynamic";

type ConflictingRule = { id: string; name: string | null; source: string | null };

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => ({}))) as {
    slotIndex?: number;
    purpose?: string | null;
  };
  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex);
  const rawPurpose = body.purpose ?? null;

  if (rawPurpose !== null && rawPurpose !== "forms" && rawPurpose !== "direct") {
    return NextResponse.json({ error: "finalidade inválida" }, { status: 400 });
  }
  const purpose = rawPurpose as SlotPurpose | null;

  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  if (purpose) {
    const conflict = await findConflictingRules(session.tenantId, slotIndex, purpose);
    if (conflict.length > 0) {
      const names = conflict.map((rule) => `«${rule.name?.trim() || rule.id}»`).join(", ");
      const blockedLabel = slotPurposeLabel(
        purposeForRuleSource(conflict[0].source) ?? (purpose === "forms" ? "direct" : "forms"),
      );
      return NextResponse.json(
        {
          error:
            `Não dá para marcar esta linha como «${slotPurposeLabel(purpose)}»: a regra ${names} ` +
            `atende ${blockedLabel} neste número. Mova essa regra para outra linha antes de travar a finalidade.`,
          code: "line_purpose_would_orphan_rules",
          rules: conflict.map((rule) => ({ id: rule.id, name: rule.name })),
        },
        { status: 409 },
      );
    }
  }

  const { error } = await setSlotPurpose(session.tenantId, slotIndex, purpose);
  if (error) {
    console.error("[whatsapp/slot-purpose] save_failed", error);
    return NextResponse.json({ error: "Não foi possível salvar a finalidade desta linha." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, slotIndex, purpose });
}

/**
 * Regras da finalidade oposta apontando para qualquer uma das conexões desta
 * linha. Considera regras **inativas** de propósito: reativar uma regra guardada
 * não pode furar a trava depois.
 */
async function findConflictingRules(
  tenantId: string,
  slotIndex: number,
  purpose: SlotPurpose,
): Promise<ConflictingRule[]> {
  const [evoRow, cloudRow] = await Promise.all([
    getEvolutionInstanceByTenantSlot(tenantId, slotIndex),
    getWhatsAppCloudConnection(tenantId, slotIndex),
  ]);
  const connectionIds = [evoRow?.id, cloudRow?.phone_number_id].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
  if (connectionIds.length === 0) return [];

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select("id, name, source")
    .eq("tenant_id", tenantId)
    .in("connection_id", connectionIds)
    .in("source", ["meta_form", "whatsapp_organico"]);

  if (error) {
    console.warn("[whatsapp/slot-purpose] conflict_query_failed", error.code ?? "", error.message);
    // Falha ao conferir não pode travar uma linha por engano nem liberar às
    // cegas: devolver vazio manteria o comportamento livre de hoje, então a
    // trava simplesmente não é aplicada nesta tentativa.
    return [];
  }

  return ((data ?? []) as ConflictingRule[]).filter(
    (rule) => purposeForRuleSource(rule.source) !== null && purposeForRuleSource(rule.source) !== purpose,
  );
}
