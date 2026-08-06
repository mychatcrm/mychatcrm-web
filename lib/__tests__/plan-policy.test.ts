import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPlanPolicy, maxCollaboratorsTotal, normalizeToPlan, PLAN_POLICY_VERSION } from "../plan-policy";
import { serverWhatsAppSlotCapacity } from "../server/whatsapp-slot-server";
import type { ClientSession } from "../client-auth";

describe("plan-policy", () => {
  it("exposes a version for billing snapshots", () => {
    expect(PLAN_POLICY_VERSION).toBe(2);
  });

  it("normalizes legacy slugs", () => {
    expect(normalizeToPlan("profissional")).toBe("equipa");
    expect(normalizeToPlan("master")).toBe("escala");
    expect(normalizeToPlan("unknown-plan")).toBe("equipa");
  });

  it("keeps solo / equipa / escala / enterprise caps aligned with commercial copy", () => {
    expect(getPlanPolicy("solo").monthlyAttendedLeadsCap).toBe(500);
    expect(getPlanPolicy("solo").includedAgents).toBe(2);
    expect(getPlanPolicy("equipa").monthlyAttendedLeadsCap).toBe(5000);
    expect(getPlanPolicy("escala").monthlyAttendedLeadsCap).toBe(15000);
    expect(getPlanPolicy("enterprise").maxSalesFunnels).toBe(100);
    expect(maxCollaboratorsTotal(getPlanPolicy("solo"))).toBe(0);
    expect(maxCollaboratorsTotal(getPlanPolicy("equipa"))).toBe(34);
  });
});

// Duas linhas por plano é o que permite separar formulário Meta de WhatsApp
// direto sem cobrar extra. Uma linha só força os dois na mesma conexão, que é
// exatamente o conflito que a finalidade por linha existe para impedir.
describe("duas linhas WhatsApp incluídas em todos os planos", () => {
  it.each(["solo", "equipa", "escala", "enterprise"] as const)(
    "plano %s inclui 2 linhas",
    (plan) => {
      expect(getPlanPolicy(plan).includedWhatsAppLines).toBe(2);
    },
  );

  it("sessão sem operationalLimits recebe as 2 linhas da policy", () => {
    const session = { plan: "equipa", operationalLimits: null } as unknown as ClientSession;
    expect(serverWhatsAppSlotCapacity(session)).toBe(2);
    expect(serverWhatsAppSlotCapacity(session, 3)).toBe(5);
  });

  it("override de enterprise_provisions ainda vence a policy", () => {
    // Antes do backfill um tenant provisionado continua em 1 linha — é por isso
    // que a migração é obrigatória, não opcional.
    const session = {
      plan: "enterprise",
      operationalLimits: { includedWhatsAppLines: 1 },
    } as unknown as ClientSession;
    expect(serverWhatsAppSlotCapacity(session)).toBe(1);
  });
});

describe("migração de backfill das linhas incluídas", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260806001631_whatsapp_included_lines_two.sql"),
    "utf8",
  );

  it("sobe included_whatsapp para 2 em enterprise_provisions", () => {
    expect(sql).toContain("update public.enterprise_provisions");
    expect(sql).toContain("set included_whatsapp = 2");
  });

  it("preserva o sentinela de sem-limite e contratos já elevados", () => {
    expect(sql).toContain("included_whatsapp is not null");
    expect(sql).toContain("included_whatsapp < 2");
  });
});
