/**
 * Ponto único que recusa parear um número que já atende outra linha.
 *
 * Roda no instante em que a Evolution confirma o `wa_jid` real do aparelho —
 * valor que vem do WhatsApp, não digitado pelo cliente, então não dá para
 * falsificar. Em conflito, a sessão nova é derrubada e o jid nunca é
 * persistido: quem estava ligado antes continua ligado, e quem tentou duplicar
 * recebe uma mensagem clara.
 */
import "server-only";
import { evolutionLogoutInstance } from "@/lib/integrations/evolution-api";
import { updateEvolutionInstanceStateByName } from "@/lib/server/tenant-evolution-instance-db";
import { notifyTenantIntegrationDisconnected } from "@/lib/server/integration-disconnect-notifications";
import {
  describeNumberConflict,
  findWhatsAppNumberOwners,
  normalizeWhatsAppNumberKey,
  type NumberOwner,
} from "@/lib/server/whatsapp-number-uniqueness";

export type NumberGuardResult =
  | { ok: true }
  | { ok: false; message: string; owner: NumberOwner };

/**
 * @param waJid JID recém-confirmado pela Evolution para esta instância.
 * @returns `ok: false` quando o número já pertence a outra linha — nesse caso a
 *          sessão já foi derrubada e a linha marcada como desconectada.
 */
export async function assertEvolutionWaJidUnique(params: {
  tenantId: string;
  slotIndex: number;
  instanceName: string;
  waJid: string;
}): Promise<NumberGuardResult> {
  const numberKey = normalizeWhatsAppNumberKey(params.waJid);
  // Sem número legível não há o que comparar — deixa seguir, senão um JID
  // exótico bloquearia um pareamento legítimo.
  if (!numberKey) return { ok: true };

  const owners = await findWhatsAppNumberOwners({
    numberKey,
    excludeEvolutionInstanceName: params.instanceName,
  });
  const conflict = owners.find(
    (owner) => !(owner.tenantId === params.tenantId && owner.slotIndex === params.slotIndex),
  );
  if (!conflict) return { ok: true };

  console.warn("[whatsapp-number-guard] duplicate_number_rejected", {
    tenant_id: params.tenantId,
    slot_index: params.slotIndex,
    instance_name: params.instanceName,
    owner_kind: conflict.kind,
    owner_slot_index: conflict.slotIndex,
    same_tenant: conflict.tenantId === params.tenantId,
  });

  // Derruba a sessão duplicada antes de qualquer outra coisa: enquanto ela
  // viver, o WhatsApp segue entregando mensagens nas duas pontas.
  try {
    await evolutionLogoutInstance(params.instanceName);
  } catch (error) {
    console.warn("[whatsapp-number-guard] logout_failed", params.instanceName, error);
  }

  // `waJid: null` é deliberado: o número duplicado não pode ficar gravado nesta
  // linha nem por um instante, senão a própria trava passa a acusá-lo depois.
  await updateEvolutionInstanceStateByName({
    instanceName: params.instanceName,
    connectionState: "close",
    waJid: null,
    preserveLifecycle: true,
  });

  try {
    await notifyTenantIntegrationDisconnected({
      tenantId: params.tenantId,
      integration: "whatsapp",
      source: "whatsapp_number_duplicate",
      sourceKey: params.instanceName,
      instanceName: params.instanceName,
      state: "close",
      previousState: "open",
      manual: false,
      metadata: {
        slot_index: params.slotIndex,
        reason: "duplicate_number",
        conflicting_slot_index: conflict.slotIndex,
        conflicting_kind: conflict.kind,
      },
    });
  } catch (error) {
    console.warn("[whatsapp-number-guard] notify_failed", error);
  }

  return { ok: false, message: describeNumberConflict(conflict, params.tenantId), owner: conflict };
}

/**
 * Checagem para a Cloud API, feita **antes** de gravar a conexão. Não derruba
 * nada — a Meta ainda não foi vinculada a esta linha neste ponto.
 */
export async function findCloudNumberConflict(params: {
  tenantId: string;
  slotIndex: number;
  displayPhone: string | null;
}): Promise<{ message: string; owner: NumberOwner } | null> {
  const numberKey = normalizeWhatsAppNumberKey(params.displayPhone);
  // A leitura do número na Graph é best-effort. Sem ela, seguir em frente é
  // melhor do que travar um onboarding legítimo por causa de chamada instável.
  if (!numberKey) return null;

  const owners = await findWhatsAppNumberOwners({
    numberKey,
    excludeCloud: { tenantId: params.tenantId, slotIndex: params.slotIndex },
  });
  const conflict = owners.find(
    (owner) => !(owner.tenantId === params.tenantId && owner.slotIndex === params.slotIndex),
  );
  if (!conflict) return null;

  return { message: describeNumberConflict(conflict, params.tenantId), owner: conflict };
}
