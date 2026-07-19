import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { sendEvolutionTextWithConnectionRecovery } from "@/lib/server/evolution-send-recovery";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { resolveOrganizationRole } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

const TEST_MESSAGE = "Teste MyChatCRM — QR Code OK";

function friendlyEvolutionSendError(raw: string | undefined): string {
  const error = raw ?? "";
  if (error === "evolution_recipient_not_found") {
    return "Esse número não tem WhatsApp ou não foi encontrado.";
  }
  if (error === "evolution_delivery_error") {
    return "O WhatsApp recusou o envio para esse número.";
  }
  if (error === "evolution_lifecycle_operation_in_progress") {
    return "Esta linha está em manutenção (reconectando/reiniciando). Tente novamente em instantes.";
  }
  if (!error.trim()) return "Falha ao enviar pelo QR Code.";
  return error.slice(0, 400);
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const role = resolveOrganizationRole(session);
  if (role === "seller") {
    return NextResponse.json({ error: "Sem permissão para testar envio WhatsApp." }, { status: 403 });
  }

  let body: { slotIndex?: number; toNumber?: string } = {};
  try {
    body = (await request.json()) as { slotIndex?: number; toNumber?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex ?? 0);
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const toNumber = String(body.toNumber ?? "").replace(/\D/g, "");
  if (toNumber.length < 10) {
    return NextResponse.json(
      { error: "Informe um número válido com DDI (só dígitos, ex.: 5562999999999)." },
      { status: 400 },
    );
  }

  const instance = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  if (!instance || instance.connection_state !== "open") {
    return NextResponse.json({ error: "QR Code não está conectado neste slot." }, { status: 409 });
  }

  const sent = await sendEvolutionTextWithConnectionRecovery({
    instanceName: instance.instance_name,
    number: toNumber,
    text: TEST_MESSAGE,
    resolveRecipient: true,
  });

  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, error: friendlyEvolutionSendError(sent.error), rawError: sent.error ?? null, status: sent.status },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, message: TEST_MESSAGE });
}
