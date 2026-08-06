/**
 * POST /api/client/whatsapp/allocate-line
 *
 * "+ Adicionar outro número" numa das duas seções (Formulários Meta / WhatsApp
 * Direto). O operador clica na seção, não escolhe um número de linha — quem
 * resolve qual slot usar é `resolveOrAllocateSlotForPurpose`.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { serverWhatsAppSlotCapacity } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { resolveOrAllocateSlotForPurpose, type SlotPurpose } from "@/lib/server/whatsapp-slot-provider";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => ({}))) as { purpose?: string };
  if (body.purpose !== "forms" && body.purpose !== "direct") {
    return NextResponse.json({ error: "finalidade inválida" }, { status: 400 });
  }
  const purpose: SlotPurpose = body.purpose;

  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  const totalSlots = serverWhatsAppSlotCapacity(session, extraWhatsappSlots);

  const result = await resolveOrAllocateSlotForPurpose({ tenantId: session.tenantId, purpose, totalSlots });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Sem linhas disponíveis. Compre mais uma linha WhatsApp para adicionar outro número.",
        code: "no_capacity",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, slotIndex: result.slotIndex, isNewSlot: result.isNewSlot });
}
