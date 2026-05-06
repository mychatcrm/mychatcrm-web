import type { ClientSession } from "@/lib/client-auth";
import { getPlanPolicy, normalizeToPlan } from "@/lib/plan-policy";

/** Alinhado ao tecto de compras em `lib/whatsapp-extra-numbers-storage.ts` (extras só no browser). */
const MAX_EXTRA_SLOTS_SERVER_CAP = 20;

/**
 * Número máximo de slots WhatsApp aceites nas rotas API (1 base + extras até tecto).
 * Incluídos no plano vêm de `getPlanPolicy` ou `session.operationalLimits` (Enterprise).
 */
export function serverWhatsAppSlotCapacity(session: ClientSession): number {
  const plan = normalizeToPlan(session.plan);
  const policy = getPlanPolicy(plan);
  const included = Math.max(1, session.operationalLimits?.includedWhatsAppLines ?? policy.includedWhatsAppLines);
  return included + MAX_EXTRA_SLOTS_SERVER_CAP;
}

export function assertSlotIndexAllowed(session: ClientSession, slotIndex: number): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < serverWhatsAppSlotCapacity(session);
}
