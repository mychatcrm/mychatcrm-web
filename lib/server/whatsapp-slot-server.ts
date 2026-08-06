import type { ClientSession } from "@/lib/client-auth";
import { getPlanIncludedWhatsAppLinesForSession } from "@/lib/plan-limits";

/**
 * Quantas linhas WhatsApp o tenant pode usar: incluídas no plano + extras compradas.
 *
 * Passa por `getPlanIncludedWhatsAppLinesForSession` de propósito. O override de
 * `operationalLimits` (gravado em `enterprise_provisions`) vence a policy, então
 * resolver isso à mão aqui deixava este ponto fora de sincronia com o resto do
 * código — que é o único lugar que decide quantos slots existem de verdade.
 */
export function serverWhatsAppSlotCapacity(session: ClientSession, extraWhatsappSlots = 0): number {
  const included = Math.max(1, getPlanIncludedWhatsAppLinesForSession(session));
  return included + extraWhatsappSlots;
}

export function assertSlotIndexAllowed(session: ClientSession, slotIndex: number, extraWhatsappSlots = 0): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < serverWhatsAppSlotCapacity(session, extraWhatsappSlots);
}
