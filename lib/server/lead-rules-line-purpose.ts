/**
 * Trava de finalidade da linha WhatsApp nas regras de distribuição.
 *
 * Uma linha marcada como «Formulários Meta» não pode receber regra de WhatsApp
 * direto, e vice-versa. Sem isso o mesmo número atende as duas coisas ao mesmo
 * tempo, que é exatamente o conflito que a separação por linha existe para
 * impedir — e o operador só descobre quando um lead deixa de ser respondido.
 *
 * Finalidade `null` significa livre e libera qualquer regra: é o padrão de toda
 * linha que nunca foi travada, e é o que garante que nenhum tenant já
 * configurado mude de comportamento no deploy desta trava.
 */
import "server-only";
import { NextResponse } from "next/server";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";
import { getSlotPurpose, type SlotPurpose } from "@/lib/server/whatsapp-slot-provider";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const PURPOSE_LABEL: Record<SlotPurpose, string> = {
  forms: "Formulários Meta",
  direct: "WhatsApp direto",
};

/** Finalidade exigida por uma origem de regra, ou `null` quando não exige nenhuma. */
export function purposeForRuleSource(source: unknown): SlotPurpose | null {
  if (source === "meta_form") return "forms";
  if (source === "whatsapp_organico") return "direct";
  return null;
}

export function slotPurposeLabel(purpose: SlotPurpose): string {
  return PURPOSE_LABEL[purpose];
}

/**
 * Em qual linha vive a conexão desta regra. Devolve `null` quando a conexão não
 * pertence ao tenant ou não existe — nesse caso a trava se cala e deixa os
 * validadores específicos (Evolution/Cloud) darem o erro certo.
 */
export async function resolveSlotIndexForRuleConnection(
  sb: ServiceClient,
  tenantId: string,
  connectionId: string,
  transport: unknown,
): Promise<number | null> {
  const id = connectionId.trim();
  if (!id) return null;

  if (transport === "cloud_api") {
    const cloud = await lookupWhatsAppCloudConnectionByPhoneNumberId(id);
    if (!cloud || cloud.tenant_id !== tenantId) return null;
    return typeof cloud.slot_index === "number" ? cloud.slot_index : null;
  }

  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("slot_index")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const slotIndex = (data as { slot_index?: unknown }).slot_index;
  return typeof slotIndex === "number" ? slotIndex : null;
}

/**
 * `null` = pode salvar. Só um conflito real de finalidade vira resposta de erro.
 */
export async function validateRuleLinePurpose(
  sb: ServiceClient,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse | null> {
  const required = purposeForRuleSource(payload.source);
  if (!required) return null;

  const connectionId = typeof payload.connection_id === "string" ? payload.connection_id.trim() : "";
  if (!connectionId) return null;

  const slotIndex = await resolveSlotIndexForRuleConnection(sb, tenantId, connectionId, payload.transport);
  if (slotIndex === null) return null;

  const purpose = await getSlotPurpose(tenantId, slotIndex);
  if (!purpose || purpose === required) return null;

  return NextResponse.json(
    {
      error:
        `A Linha ${slotIndex + 1} está reservada para ${slotPurposeLabel(purpose)}. ` +
        `Escolha uma linha marcada como «${slotPurposeLabel(required)}», ou mude a finalidade da linha em Integrações → WhatsApp.`,
      code: "line_purpose_mismatch",
    },
    { status: 409 },
  );
}
