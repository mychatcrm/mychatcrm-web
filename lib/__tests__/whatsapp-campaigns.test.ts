import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listTenantWhatsappConnectionsMock,
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
  listWhatsAppMessageTemplatesMock,
  sendWhatsAppTemplateMessageMock,
  evolutionSendTextMock,
  activateLeadJourneyMock,
  touchLeadJourneyMock,
  scheduleLeadRedistributionMock,
} = vi.hoisted(() => ({
  listTenantWhatsappConnectionsMock: vi.fn(),
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
  sendWhatsAppTemplateMessageMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
  activateLeadJourneyMock: vi.fn(),
  touchLeadJourneyMock: vi.fn(),
  scheduleLeadRedistributionMock: vi.fn(),
}));

vi.mock("@/lib/server/tenant-whatsapp-connections", () => ({
  listTenantWhatsappConnections: listTenantWhatsappConnectionsMock,
}));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId: lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
}));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  listWhatsAppMessageTemplates: listWhatsAppMessageTemplatesMock,
  sendWhatsAppTemplateMessage: sendWhatsAppTemplateMessageMock,
}));
vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionSendText: evolutionSendTextMock,
}));
vi.mock("@/lib/server/lead-journeys", () => ({
  isJourneyIsolationEnabled: () => true,
  activateLeadJourney: activateLeadJourneyMock,
  touchLeadJourney: touchLeadJourneyMock,
}));
vi.mock("@/lib/server/lead-redistribution", () => ({
  scheduleLeadRedistribution: scheduleLeadRedistributionMock,
}));

import {
  createWhatsAppCampaign,
  leadMatchesWhatsAppCampaignAudience,
  renderWhatsAppCampaignTemplate,
} from "@/lib/server/whatsapp-campaigns";

describe("WhatsApp campaign helpers", () => {
  const lead = {
    name: "Maria",
    phone: "+55 (62) 99999-1111",
    status: "contato",
    profile_metadata: {
      empresa: "Clínica Centro",
      tags: ["Paciente", "Retorno"],
    },
  };

  it("renders only the documented lead variables", () => {
    expect(
      renderWhatsAppCampaignTemplate(
        "Olá {{nome}} da {{empresa}}. Seu telefone é {{telefone}}.",
        lead,
      ),
    ).toBe("Olá Maria da Clínica Centro. Seu telefone é 5562999991111.");
  });

  it("matches complete, tag and funnel-stage audiences deterministically", () => {
    expect(leadMatchesWhatsAppCampaignAudience(lead, "all", null)).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "tag", "paciente")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "tag", "outro")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "funnel_stage", "contato")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "funnel_stage", "novo")).toBe(false);
  });
});

type Row = Record<string, unknown>;

function makeBuilder(resultProvider: () => { data: unknown; error: unknown }, captureInsert?: (payload: unknown) => void) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "is", "not", "limit", "order", "update", "delete"];
  chainMethods.forEach((method) => {
    builder[method] = () => builder;
  });
  builder.insert = (payload: unknown) => {
    captureInsert?.(payload);
    return builder;
  };
  builder.maybeSingle = async () => resultProvider();
  builder.single = async () => resultProvider();
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resultProvider()).then(resolve, reject);
  return builder;
}

function makeSb(options: {
  agentRow: Row | null;
  leadRows: Row[];
  insertedCampaign: Row;
  captureCampaignInsert?: (payload: unknown) => void;
}) {
  return {
    from: (table: string) => {
      if (table === "tenant_agents") return makeBuilder(() => ({ data: options.agentRow, error: null }));
      if (table === "leads") return makeBuilder(() => ({ data: options.leadRows, error: null }));
      if (table === "whatsapp_campaigns") {
        return makeBuilder(
          () => ({ data: options.insertedCampaign, error: null }),
          options.captureCampaignInsert,
        );
      }
      if (table === "whatsapp_campaign_recipients") return makeBuilder(() => ({ data: null, error: null }));
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const OPTED_IN_LEAD: Row = {
  id: "lead-1",
  name: "Marina",
  phone: "5511999990000",
  status: "novo",
  profile_metadata: {},
  whatsapp_opt_in_at: "2026-07-01T00:00:00.000Z",
  whatsapp_opt_in_source: "crm_manual_confirmation",
};

describe("createWhatsAppCampaign — transporte cloud_api (API Meta)", () => {
  beforeEach(() => {
    listTenantWhatsappConnectionsMock.mockReset();
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockReset();
    listWhatsAppMessageTemplatesMock.mockReset();
    listTenantWhatsappConnectionsMock.mockResolvedValue([
      { connectionId: "pn-1", transport: "cloud_api", label: "API Meta", slotIndex: 0, connected: true, activeProvider: "cloud_api" },
    ]);
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      id: "conn-1",
      tenant_id: "tenant-1",
      slot_index: 0,
      phone_number_id: "pn-1",
      waba_id: "waba-1",
      access_token: "token-1",
      display_phone: null,
      verified_name: null,
      active: true,
      connected_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("aceita a campanha quando o template está aprovado, e grava transport/meta_template_*", async () => {
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "promo_v1", status: "APPROVED", category: "MARKETING", language: "pt_BR", bodyText: "Oi {{1}}", bodyParamCount: 1 },
    ]);
    let captured: Row | undefined;
    const sb = makeSb({
      agentRow: { agent_id: "agent-1", active: true },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
      captureCampaignInsert: (payload) => {
        captured = payload as Row;
      },
    });

    const campaign = await createWhatsAppCampaign({
      sb,
      tenantId: "tenant-1",
      createdBy: "owner@test.com",
      input: {
        name: "Campanha Meta",
        connectionId: "pn-1",
        agentId: "agent-1",
        audienceType: "all",
        messageTemplate: "",
        metaTemplateName: "promo_v1",
        metaTemplateLang: null,
        throughput: "normal",
      },
    });

    expect(campaign).toEqual({ id: "camp-1" });
    expect(captured?.transport).toBe("cloud_api");
    expect(captured?.connection_id).toBe("pn-1");
    expect(captured?.meta_template_name).toBe("promo_v1");
    expect(captured?.meta_template_lang).toBe("pt_BR");
  });

  it("rejeita quando nenhum template foi escolhido", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "agent-1", active: true },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: {
          name: "Campanha Meta",
          connectionId: "pn-1",
          agentId: "agent-1",
          audienceType: "all",
          messageTemplate: "",
          metaTemplateName: null,
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_meta_template_required");
  });

  it("rejeita quando o template escolhido não está aprovado", async () => {
    listWhatsAppMessageTemplatesMock.mockResolvedValue([
      { name: "promo_v1", status: "PENDING", category: "MARKETING", language: "pt_BR", bodyText: "Oi {{1}}", bodyParamCount: 1 },
    ]);
    const sb = makeSb({
      agentRow: { agent_id: "agent-1", active: true },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: {
          name: "Campanha Meta",
          connectionId: "pn-1",
          agentId: "agent-1",
          audienceType: "all",
          messageTemplate: "",
          metaTemplateName: "promo_v1",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_meta_template_not_approved");
  });
});

describe("createWhatsAppCampaign — agente obrigatório", () => {
  beforeEach(() => {
    listTenantWhatsappConnectionsMock.mockReset();
    listTenantWhatsappConnectionsMock.mockResolvedValue([
      { connectionId: "evo-1", transport: "evolution", label: "QR Code", slotIndex: 0, connected: true, activeProvider: "evolution" },
    ]);
  });

  it("rejeita quando nenhum agentId foi informado", async () => {
    const sb = makeSb({ agentRow: null, leadRows: [], insertedCampaign: { id: "camp-1" } });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: {
          name: "Campanha",
          connectionId: "evo-1",
          agentId: "",
          audienceType: "all",
          messageTemplate: "Olá {{nome}}",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_required_fields");
  });

  it("rejeita quando o agente selecionado não está ativo", async () => {
    const sb = makeSb({ agentRow: null, leadRows: [OPTED_IN_LEAD], insertedCampaign: { id: "camp-1" } });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: {
          name: "Campanha",
          connectionId: "evo-1",
          agentId: "agent-inativo",
          audienceType: "all",
          messageTemplate: "Olá {{nome}}",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_agent_not_available");
  });
});
