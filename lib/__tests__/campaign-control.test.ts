import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/tenant-whatsapp-connections", () => ({ listTenantWhatsappConnections: vi.fn() }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ lookupWhatsAppCloudConnectionByPhoneNumberId: vi.fn() }));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  listWhatsAppMessageTemplates: vi.fn(),
  sendWhatsAppTemplateMessage: vi.fn(),
}));
vi.mock("@/lib/integrations/evolution-api", () => ({ evolutionSendText: vi.fn() }));
vi.mock("@/lib/server/lead-journeys", () => ({
  isJourneyIsolationEnabled: () => true,
  activateLeadJourney: vi.fn(),
  touchLeadJourney: vi.fn(),
}));
vi.mock("@/lib/server/lead-redistribution", () => ({ scheduleLeadRedistribution: vi.fn() }));
vi.mock("@/lib/server/team-employees-db", () => ({ readTeamMembersFromDb: vi.fn() }));

import { controlWhatsAppCampaign } from "@/lib/server/whatsapp-campaigns";

/**
 * Play, pause e "começar do zero" — o painel de controle do card.
 *
 * O que estes testes seguram é o que torna a coisa confiável: pausar não pode
 * reenviar nada, retomar continua da fila que estava (nunca do começo), e
 * zerar devolve TODO mundo pra fila.
 */

type Row = Record<string, unknown>;

function makeSb(options: {
  currentStatus: string | null;
  onCampaignUpdate?: (patch: Row) => void;
  onRecipientsUpdate?: (patch: Row) => void;
  ruleValid?: boolean;
}) {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      let lastPatch: Row | null = null;
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.update = (patch: Row) => {
        lastPatch = patch;
        if (table === "whatsapp_campaigns") options.onCampaignUpdate?.(patch);
        else options.onRecipientsUpdate?.(patch);
        return builder;
      };
      builder.maybeSingle = async () => {
        if (table === "tenant_agents") {
          return { data: { active: true, metadata: { status: "ativo" } }, error: null };
        }
        if (table === "lead_distribution_rules") {
          return options.ruleValid === false
            ? { data: null, error: null }
            : {
                data: {
                  source: "whatsapp_campaign",
                  active: true,
                  transport: "evolution",
                  connection_id: "evo-1",
                  agent_ids: ["agent-1"],
                },
                error: null,
              };
        }
        return options.currentStatus === null
          ? { data: null, error: null }
          : {
              data: {
                id: "camp-1",
                tenant_id: "tenant-1",
                status: options.currentStatus,
                rule_id: "rule-1",
                agent_id: "agent-1",
                connection_id: "evo-1",
                transport: "evolution",
                timezone: "UTC",
              },
              error: null,
            };
      };
      builder.single = async () => ({ data: { id: "camp-1", ...(lastPatch ?? {}) }, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      return builder;
    },
  } as never;
}

const base = { tenantId: "tenant-1", campaignId: "camp-1" };

describe("controlWhatsAppCampaign — pause", () => {
  it("pausa uma campanha que está enviando", async () => {
    let patch: Row | undefined;
    const sb = makeSb({ currentStatus: "processing", onCampaignUpdate: (p) => (patch = p) });
    await controlWhatsAppCampaign({ sb, ...base, action: "pause" });
    expect(patch?.status).toBe("paused");
  });

  it("recusa pausar o que não está enviando — não há o que segurar", async () => {
    const sb = makeSb({ currentStatus: "draft" });
    await expect(controlWhatsAppCampaign({ sb, ...base, action: "pause" })).rejects.toThrow("campaign_not_running");
  });
});

describe("controlWhatsAppCampaign — start", () => {
  it("inicia uma campanha salva e parada", async () => {
    let patch: Row | undefined;
    const sb = makeSb({ currentStatus: "draft", onCampaignUpdate: (p) => (patch = p) });
    await controlWhatsAppCampaign({ sb, ...base, action: "start" });
    expect(patch?.status).toBe("scheduled");
  });

  it("retoma uma pausada SEM tocar nos destinatários — é o que faz continuar de onde parou", async () => {
    let patch: Row | undefined;
    const onRecipientsUpdate = vi.fn();
    const sb = makeSb({ currentStatus: "paused", onCampaignUpdate: (p) => (patch = p), onRecipientsUpdate });
    await controlWhatsAppCampaign({ sb, ...base, action: "start" });
    expect(patch?.status).toBe("scheduled");
    // Quem já recebeu continua marcado como enviado: retomar não reenvia.
    expect(onRecipientsUpdate).not.toHaveBeenCalled();
  });

  it("recusa iniciar o que já terminou — pra rodar de novo é 'começar do zero'", async () => {
    const sb = makeSb({ currentStatus: "completed" });
    await expect(controlWhatsAppCampaign({ sb, ...base, action: "start" })).rejects.toThrow("campaign_not_startable");
  });

  it("não inicia quando a regra foi removida ou desativada", async () => {
    let patch: Row | undefined;
    const sb = makeSb({
      currentStatus: "draft",
      ruleValid: false,
      onCampaignUpdate: (value) => (patch = value),
    });
    await expect(controlWhatsAppCampaign({ sb, ...base, action: "start" })).rejects.toThrow(
      "campaign_rule_not_authorized",
    );
    expect(patch?.status).toBe("review_required");
  });
});

describe("controlWhatsAppCampaign — reset", () => {
  it("devolve todo destinatário pra fila e zera o placar", async () => {
    let campaignPatch: Row | undefined;
    let recipientsPatch: Row | undefined;
    const sb = makeSb({
      currentStatus: "completed",
      onCampaignUpdate: (p) => (campaignPatch = p),
      onRecipientsUpdate: (p) => (recipientsPatch = p),
    });

    await controlWhatsAppCampaign({ sb, ...base, action: "reset" });

    expect(recipientsPatch?.status).toBe("pending");
    expect(recipientsPatch?.sent_at).toBeNull();
    expect(recipientsPatch?.attempts).toBe(0);
    expect(campaignPatch?.status).toBe("draft");
    expect(campaignPatch?.total_sent).toBe(0);
    expect(campaignPatch?.total_failed).toBe(0);
  });

  it("zerar deixa a campanha PARADA — quem dá play é o cliente", async () => {
    let campaignPatch: Row | undefined;
    const sb = makeSb({ currentStatus: "processing", onCampaignUpdate: (p) => (campaignPatch = p) });
    await controlWhatsAppCampaign({ sb, ...base, action: "reset" });
    expect(campaignPatch?.status).toBe("draft");
  });
});

describe("controlWhatsAppCampaign — campanha inexistente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa qualquer ação em id que não existe no tenant", async () => {
    const sb = makeSb({ currentStatus: null });
    await expect(controlWhatsAppCampaign({ sb, ...base, action: "start" })).rejects.toThrow("campaign_not_found");
  });
});

describe("contrato: salvar não dispara, e uma pausa não é desfeita sozinha", () => {
  const source = readFileSync(join(process.cwd(), "lib/server/whatsapp-campaigns.ts"), "utf8");

  it("campanha nasce parada — salvar nunca começa a enviar", () => {
    expect(source).toContain('status: "draft"');
  });

  it("o processador só pega o que o cliente mandou rodar", () => {
    expect(source).toContain('.in("status", ["scheduled", "processing"])');
  });

  it("o update final do lote não sobrescreve um pause feito no meio", () => {
    // Sem o `.in(status)` nesse update, pausar durante uma passada seria
    // desfeito segundos depois pelo próprio processador.
    const finalUpdate = source.indexOf('status: pending ? "processing" : "completed"');
    expect(finalUpdate).toBeGreaterThan(-1);
    expect(source.slice(finalUpdate, finalUpdate + 400)).toContain('.in("status", ["scheduled", "processing"])');
  });
});
