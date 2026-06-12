import type { ClientSession } from "@/lib/client-auth";
import { getPlanPolicy, normalizeToPlan } from "@/lib/plan-policy";

export function serverWhatsAppSlotCapacity(session: ClientSession, extraWhatsappSlots = 0): number {
  const plan = normalizeToPlan(session.plan);
  const policy = getPlanPolicy(plan);
  const included = Math.max(1, session.operationalLimits?.includedWhatsAppLines ?? policy.includedWhatsAppLines);
  return included + extraWhatsappSlots;
}

export function assertSlotIndexAllowed(session: ClientSession, slotIndex: number, extraWhatsappSlots = 0): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < serverWhatsAppSlotCapacity(session, extraWhatsappSlots);
}
