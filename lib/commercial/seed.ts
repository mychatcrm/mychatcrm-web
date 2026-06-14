import { randomUUID } from "crypto";
import type { CommercialStore } from "@/lib/commercial/types";

export function buildSeedCommercialStore(): CommercialStore {
  const now = new Date().toISOString();
  const partnerId = `prt_${randomUUID().slice(0, 8)}`;
  const couponPartner = `cpn_${randomUUID().slice(0, 8)}`;
  const couponSolo = `cpn_${randomUUID().slice(0, 8)}`;

  return {
    version: 1,
    partners: [
      {
        id: partnerId,
        name: "Parceiro Demo Premium",
        code: "PDEMO",
        email: "parceiros@mychatcrm.com.br",
        socialNotes: "LinkedIn: /company/mychatcrm · Instagram: @mychatcrm",
        status: "active",
        observations: "Campanha interna de homologação — não usar em produção sem revisão jurídica.",
        startedAt: "2026-01-01",
        commissionType: "percent",
        commissionValue: 12,
        commissionTiming: "once",
        commissionRecurrenceMonths: null,
        campaignActive: true,
        linkedCouponIds: [couponPartner],
        createdAt: now,
        updatedAt: now,
      },
    ],
    coupons: [
      {
        id: couponSolo,
        code: "SOLO15",
        internalName: "Desconto Solo 15%",
        description: "15% no primeiro mês — plano Solo.",
        discountType: "percent",
        discountValue: 15,
        validFrom: null,
        validUntil: null,
        maxRedemptionsTotal: null,
        maxRedemptionsPerUser: 1,
        allowedPlanSlugs: ["solo"],
        discountRecurrence: "first_cycle",
        recurringCyclesLimit: null,
        active: true,
        partnerId: null,
        stripeCouponId: null,
        stripePromoCodeId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: couponPartner,
        code: "EQUIPAFRETE",
        internalName: "Campanha Equipa + parceiro",
        description: "R$ 50,00 no primeiro ciclo — Equipa, rastreado com comissão.",
        discountType: "fixed",
        discountValue: 5000,
        validFrom: null,
        validUntil: null,
        maxRedemptionsTotal: 500,
        maxRedemptionsPerUser: 2,
        allowedPlanSlugs: ["equipa"],
        discountRecurrence: "first_cycle",
        recurringCyclesLimit: null,
        active: true,
        partnerId,
        stripeCouponId: null,
        stripePromoCodeId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    redemptions: [],
    auditLog: [],
  };
}
