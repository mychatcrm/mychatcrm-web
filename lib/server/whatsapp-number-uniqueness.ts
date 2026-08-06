/**
 * Um número de WhatsApp, uma linha só.
 *
 * O WhatsApp multi-dispositivo permite parear o mesmo aparelho em várias
 * sessões ao mesmo tempo — como abrir o WhatsApp Web em várias abas. Sem esta
 * checagem, dá para ligar o mesmo número na Linha 1 e na Linha 2 e furar a
 * separação por finalidade: o mesmo número atenderia formulário e contato
 * espontâneo de novo, que é exatamente o que a separação existe para impedir.
 *
 * A comparação é por número físico normalizado, e não por identificador de
 * conexão: senão bastaria variar o provedor (QR numa linha, API Meta na outra)
 * para escapar.
 */
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  brazilianMobileAlternateVariant,
  ensureBrazilianMobileWhatsappDigits,
  jidToDigits,
} from "@/lib/integrations/evolution-api";

export type NumberOwnerKind = "evolution" | "cloud";

export type NumberOwner = {
  kind: NumberOwnerKind;
  tenantId: string;
  slotIndex: number;
  /** UUID da instância Evolution ou phone_number_id da Cloud API. */
  connectionId: string;
  instanceName?: string | null;
};

/**
 * Chave canônica do número físico. Aceita JID (`5562…@s.whatsapp.net`, `…@lid`)
 * ou telefone formatado (`+55 62 99123-4567`, do `display_phone` da Meta).
 */
export function normalizeWhatsAppNumberKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.includes("@") ? jidToDigits(trimmed) : trimmed.replace(/\D/g, "");
  if (!digits) return null;
  const normalized = ensureBrazilianMobileWhatsappDigits(digits);
  return normalized.length >= 8 ? normalized : null;
}

/**
 * Todas as grafias do mesmo número físico. No Brasil o mesmo telefone aparece
 * com e sem o 9º dígito dependendo de onde veio, e as duas formas precisam
 * colidir — senão a trava é burlada só mudando a grafia.
 */
export function whatsAppNumberKeyVariants(key: string): string[] {
  const variants = [key];
  const alternate = brazilianMobileAlternateVariant(key);
  if (alternate && alternate !== key) variants.push(alternate);
  return variants;
}

export function isSameWhatsAppNumber(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const keyA = normalizeWhatsAppNumberKey(a);
  const keyB = normalizeWhatsAppNumberKey(b);
  if (!keyA || !keyB) return false;
  return whatsAppNumberKeyVariants(keyA).includes(keyB);
}

/**
 * Quem já usa este número, em qualquer tenant e em qualquer provedor.
 *
 * As exclusões existem para o re-pareamento da própria linha não se acusar:
 * reconectar a mesma instância com o mesmo número é operação normal.
 */
export async function findWhatsAppNumberOwners(params: {
  numberKey: string;
  /** Instância Evolution que está pareando agora — não conta como conflito. */
  excludeEvolutionInstanceName?: string | null;
  /** Linha Cloud que está conectando agora — não conta como conflito. */
  excludeCloud?: { tenantId: string; slotIndex: number } | null;
}): Promise<NumberOwner[]> {
  const variants = whatsAppNumberKeyVariants(params.numberKey);
  if (variants.length === 0) return [];

  const sb = createSupabaseServiceClient();
  const owners: NumberOwner[] = [];

  // `wa_jid` guarda o sufixo do domínio (@s.whatsapp.net ou @lid), então o
  // casamento é por prefixo de dígitos, não por igualdade exata.
  const { data: evoRows, error: evoError } = await sb
    .from("tenant_evolution_instances")
    .select("id, tenant_id, slot_index, instance_name, wa_jid")
    .or(variants.map((digits) => `wa_jid.like.${digits}@%`).join(","));

  if (evoError) {
    console.warn("[whatsapp-number-uniqueness] evolution_lookup_failed", evoError.message);
  } else {
    for (const row of (evoRows ?? []) as Array<{
      id: string;
      tenant_id: string;
      slot_index: number;
      instance_name: string;
      wa_jid: string | null;
    }>) {
      if (params.excludeEvolutionInstanceName && row.instance_name === params.excludeEvolutionInstanceName) {
        continue;
      }
      // Confirma pela chave normalizada: o `like` casa prefixo de dígitos e um
      // número mais longo com o mesmo começo passaria por engano.
      if (!isSameWhatsAppNumber(row.wa_jid, params.numberKey)) continue;
      owners.push({
        kind: "evolution",
        tenantId: row.tenant_id,
        slotIndex: row.slot_index,
        connectionId: row.id,
        instanceName: row.instance_name,
      });
    }
  }

  // A Cloud API guarda o número formatado para leitura humana, então a
  // comparação tem que ser normalizada em JS — não dá para filtrar no banco.
  const { data: cloudRows, error: cloudError } = await sb
    .from("whatsapp_cloud_connections")
    .select("tenant_id, slot_index, phone_number_id, display_phone")
    .eq("active", true);

  if (cloudError) {
    console.warn("[whatsapp-number-uniqueness] cloud_lookup_failed", cloudError.message);
  } else {
    for (const row of (cloudRows ?? []) as Array<{
      tenant_id: string;
      slot_index: number;
      phone_number_id: string;
      display_phone: string | null;
    }>) {
      if (
        params.excludeCloud &&
        row.tenant_id === params.excludeCloud.tenantId &&
        row.slot_index === params.excludeCloud.slotIndex
      ) {
        continue;
      }
      if (!isSameWhatsAppNumber(row.display_phone, params.numberKey)) continue;
      owners.push({
        kind: "cloud",
        tenantId: row.tenant_id,
        slotIndex: row.slot_index,
        connectionId: row.phone_number_id,
      });
    }
  }

  return owners;
}

/**
 * Mensagem para o operador. Nunca revela nada sobre a outra conta quando o
 * número pertence a outro tenant.
 */
export function describeNumberConflict(owner: NumberOwner, tenantId: string): string {
  if (owner.tenantId !== tenantId) {
    return "Este número já está ligado em outra conta do MyChatCRM. Desconecte-o lá antes de ligar aqui, ou fale com o suporte.";
  }
  return `Este número já está ligado na Linha ${owner.slotIndex + 1} desta conta. Cada número atende uma linha só: desligue lá antes de ligar aqui.`;
}
