/**
 * Casos nomeados do dinheiro e do formulário.
 *
 * Duas áreas onde um erro não dá erro — dá prejuízo silencioso: crédito cobrado
 * duas vezes (ou nunca), e lead recusado sem ninguém perceber.
 */
import { describe, expect, it } from "vitest";

import {
  buildCreditIdempotencyKey,
  buildPurchaseIdempotencyKey,
  canAffordAction,
  creditMoveMessage,
  simulateCreditMove,
} from "@/lib/credits/ledger";
import {
  CREDIT_ACTION_COST,
  creditUnitPriceBRL,
  findCreditPack,
  includedLandingPagesForPlan,
  resolveLandingPageAllowance,
} from "@/lib/credits/pricing";
import {
  buildSubmissionDedupKey,
  canonicalLeadPhone,
  defaultLandingFormFields,
  validateLandingSubmission,
} from "@/lib/landing/form-schema";

describe("créditos", () => {
  it("nunca deixa o saldo ficar negativo", () => {
    expect(simulateCreditMove({ balance: 2, delta: -5 })).toEqual({
      applied: false,
      balance: 2,
      reasonCode: "insufficient",
    });
    expect(simulateCreditMove({ balance: 5, delta: -5 }).balance).toBe(0);
  });

  it("trata repetição como já feito, sem cobrar de novo", () => {
    const repeat = simulateCreditMove({ balance: 10, delta: -5, alreadyApplied: true });
    expect(repeat.applied).toBe(false);
    expect(repeat.balance).toBe(10);
    expect(creditMoveMessage(repeat)).toContain("já tinha sido feita");
  });

  it("dá a mesma chave à mesma intenção e chaves diferentes a intenções diferentes", () => {
    const base = { action: "landing_generate_page" as const, tenantId: "t1", refId: "p1" };
    expect(buildCreditIdempotencyKey({ ...base, attemptToken: "a" })).toBe(
      buildCreditIdempotencyKey({ ...base, attemptToken: "a" }),
    );
    // Token diferente = nova intenção deliberada, cobra.
    expect(buildCreditIdempotencyKey({ ...base, attemptToken: "a" })).not.toBe(
      buildCreditIdempotencyKey({ ...base, attemptToken: "b" }),
    );
    // Página diferente = ação diferente.
    expect(buildCreditIdempotencyKey({ ...base, attemptToken: "a" })).not.toBe(
      buildCreditIdempotencyKey({ ...base, refId: "p2", attemptToken: "a" }),
    );
    // Tenant diferente jamais colide.
    expect(buildCreditIdempotencyKey({ ...base, attemptToken: "a" })).not.toBe(
      buildCreditIdempotencyKey({ ...base, tenantId: "t2", attemptToken: "a" }),
    );
  });

  it("usa o evento do Stripe como chave da compra", () => {
    // A Stripe reenvia o mesmo evento quando a nossa resposta demora.
    expect(buildPurchaseIdempotencyKey("evt_1")).toBe(buildPurchaseIdempotencyKey("evt_1"));
    expect(buildPurchaseIdempotencyKey("evt_1")).not.toBe(buildPurchaseIdempotencyKey("evt_2"));
  });

  it("diz exatamente quantos créditos faltam", () => {
    const check = canAffordAction({ action: "landing_generate_page", balance: 3 });
    expect(check.affordable).toBe(false);
    expect(check.missing).toBe(CREDIT_ACTION_COST.landing_generate_page - 3);
  });

  it("torna o pacote maior mais barato por crédito", () => {
    const packs = ["credits_10", "credits_30", "credits_100"].map((code) => {
      const pack = findCreditPack(code);
      expect(pack).not.toBeNull();
      return creditUnitPriceBRL(pack!);
    });
    expect(packs[0]).toBeGreaterThan(packs[1]);
    expect(packs[1]).toBeGreaterThan(packs[2]);
  });

  it("recusa pacote desconhecido", () => {
    expect(findCreditPack("credits_999")).toBeNull();
    expect(findCreditPack(null)).toBeNull();
    expect(findCreditPack(42)).toBeNull();
  });
});

describe("limite de páginas por plano", () => {
  it("cresce com o plano", () => {
    expect(includedLandingPagesForPlan("solo")).toBeLessThan(includedLandingPagesForPlan("equipa"));
    expect(includedLandingPagesForPlan("equipa")).toBeLessThan(includedLandingPagesForPlan("escala"));
  });

  it("plano desconhecido cai no mais restrito", () => {
    expect(includedLandingPagesForPlan("inexistente")).toBe(includedLandingPagesForPlan("solo"));
    expect(includedLandingPagesForPlan(null)).toBe(includedLandingPagesForPlan("solo"));
  });

  it("soma os extras e nunca devolve saldo negativo", () => {
    const allowance = resolveLandingPageAllowance({
      plan: "solo",
      extraEntitlements: 2,
      publishedCount: 10,
    });
    expect(allowance.cap).toBe(3);
    expect(allowance.remaining).toBe(0);
  });
});

describe("formulário público", () => {
  const fields = defaultLandingFormFields();

  it("aceita uma submissão válida", () => {
    const result = validateLandingSubmission({
      fields,
      payload: { name: "Ana Souza", phone: "(62) 99988-7766", email: "ana@exemplo.com" },
      consentGiven: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phoneDigits).toBe("62999887766");
      expect(result.email).toBe("ana@exemplo.com");
    }
  });

  it("exige consentimento", () => {
    const result = validateLandingSubmission({
      fields,
      payload: { name: "Ana", phone: "62999887766" },
      consentGiven: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.consent).toBeTruthy();
  });

  it("recusa telefone que não é celular com WhatsApp", () => {
    for (const phone of ["6233334444", "00999887766", "123", "62 88888-8888"]) {
      const result = validateLandingSubmission({
        fields,
        payload: { name: "Ana", phone },
        consentGiven: true,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("descarta chave que não está na definição da versão", () => {
    const result = validateLandingSubmission({
      fields,
      payload: {
        name: "Ana",
        phone: "62999887766",
        tenant_id: "outro-tenant",
        status: "ganho",
        owner_employee_id: "alguem",
      },
      consentGiven: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.values).sort()).toEqual(["name", "phone"]);
    }
  });

  it("grava o telefone na mesma forma que a Meta e o WhatsApp", () => {
    /**
     * Regressão cara: `checkWhatsapp` devolve dígitos locais e os outros dois
     * caminhos de lead gravam com o 55. Gravar sem o prefixo criava uma SEGUNDA
     * linha para a mesma pessoa — e a conversa do WhatsApp anexava-se ao outro
     * lead, deixando a atribuição da campanha órfã.
     */
    const doMeta = (raw: string) => {
      const d = raw.replace(/\D/g, "");
      const s2 = d.startsWith("0") ? d.slice(1) : d;
      return s2.length >= 10 && s2.length <= 11 && !s2.startsWith("55") ? `55${s2}` : s2;
    };
    const doWhatsApp = (jid: string) => (jid.split("@")[0] ?? "").replace(/\D/g, "");

    const submission = validateLandingSubmission({
      fields,
      payload: { name: "Ana", phone: "(62) 99988-7766" },
      consentGiven: true,
    });
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;

    const daLanding = canonicalLeadPhone(submission.phoneDigits);
    expect(daLanding).toBe(doMeta("62999887766"));
    expect(daLanding).toBe(doWhatsApp("5562999887766@s.whatsapp.net"));
    expect(daLanding).toBe("5562999887766");
  });

  it("não duplica o 55 nem perde número já internacional", () => {
    expect(canonicalLeadPhone("5562999887766")).toBe("5562999887766");
    expect(canonicalLeadPhone("62999887766")).toBe("5562999887766");
    expect(canonicalLeadPhone("062999887766")).toBe("5562999887766");
    expect(canonicalLeadPhone("(62) 99988-7766")).toBe("5562999887766");
    expect(canonicalLeadPhone("")).toBe("");
  });

  it("junta o duplo clique e separa a visita de outro dia", () => {
    const phoneDigits = "62999887766";
    const at = new Date("2026-09-18T10:00:00Z");
    const segundos = new Date("2026-09-18T10:00:20Z");
    const amanha = new Date("2026-09-19T10:00:00Z");

    expect(buildSubmissionDedupKey({ phoneDigits, at })).toBe(
      buildSubmissionDedupKey({ phoneDigits, at: segundos }),
    );
    expect(buildSubmissionDedupKey({ phoneDigits, at })).not.toBe(
      buildSubmissionDedupKey({ phoneDigits, at: amanha }),
    );
  });
});
