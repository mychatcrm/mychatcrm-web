import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listTenantWhatsappConnectionsMock,
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
  listWhatsAppMessageTemplatesMock,
  sendWhatsAppTemplateMessageMock,
  evolutionSendTextMock,
  activateLeadJourneyMock,
  touchLeadJourneyMock,
  scheduleLeadRedistributionMock,
  readTeamMembersFromDbMock,
} = vi.hoisted(() => ({
  listTenantWhatsappConnectionsMock: vi.fn(),
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  listWhatsAppMessageTemplatesMock: vi.fn(),
  sendWhatsAppTemplateMessageMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
  activateLeadJourneyMock: vi.fn(),
  touchLeadJourneyMock: vi.fn(),
  scheduleLeadRedistributionMock: vi.fn(),
  readTeamMembersFromDbMock: vi.fn(),
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
vi.mock("@/lib/server/team-employees-db", () => ({
  readTeamMembersFromDb: readTeamMembersFromDbMock,
}));

import {
  buildCampaignLeadPatch,
  computeDistinctLeadTags,
  createWhatsAppCampaign,
  leadMatchesWhatsAppCampaignAudience,
  parseCampaignAudienceBlocks,
  parseCampaignLeadDestination,
  renderWhatsAppCampaignTemplate,
  resolveWhatsAppCampaignAudience,
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

describe("leadMatchesWhatsAppCampaignAudience — data de cadastro", () => {
  // Quarta-feira, meio-dia em São Paulo.
  const NOW = new Date("2026-08-19T15:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cadastro_dias: pega quem tem N dias ou mais, não quem tem menos", () => {
    const antigo = { created_at: "2026-06-01T12:00:00.000Z" }; // ~79 dias atrás
    const recente = { created_at: "2026-08-15T12:00:00.000Z" }; // 4 dias atrás
    expect(leadMatchesWhatsAppCampaignAudience(antigo, "cadastro_dias", "30")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(recente, "cadastro_dias", "30")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience(recente, "cadastro_dias", "0")).toBe(true);
  });

  it("cadastro_dias: valor inválido nunca bate (nem trava)", () => {
    const lead = { created_at: "2026-06-01T12:00:00.000Z" };
    expect(leadMatchesWhatsAppCampaignAudience(lead, "cadastro_dias", "não é número")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "cadastro_dias", "-5")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience({ created_at: "data inválida" }, "cadastro_dias", "30")).toBe(false);
  });

  it("cadastro_data: bate só o dia exato, no fuso America/Sao_Paulo", () => {
    // 19/08 às 23h UTC ainda é 19/08 em São Paulo (UTC-3); 20/08 às 02h UTC também é 19/08 lá.
    const noDia = { created_at: "2026-08-20T02:30:00.000Z" };
    const outroDia = { created_at: "2026-08-18T23:30:00.000Z" }; // 18/08 em São Paulo
    expect(leadMatchesWhatsAppCampaignAudience(noDia, "cadastro_data", "2026-08-19")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(outroDia, "cadastro_data", "2026-08-19")).toBe(false);
  });

  it("cadastro_data: sem created_at ou valor vazio nunca bate", () => {
    expect(leadMatchesWhatsAppCampaignAudience({}, "cadastro_data", "2026-08-19")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience({ created_at: "2026-08-19T12:00:00.000Z" }, "cadastro_data", null)).toBe(
      false,
    );
  });
});

describe("computeDistinctLeadTags", () => {
  it("deduplica case-insensitive mantendo a primeira grafia vista e ordena", () => {
    const leads = [
      { profile_metadata: { tags: ["VIP", "Retorno"] } },
      { profile_metadata: { tags: ["vip", "Frio"] } },
      { profile_metadata: {} },
      { profile_metadata: { tags: "não é array" } },
      { profile_metadata: null },
      {},
    ];
    expect(computeDistinctLeadTags(leads)).toEqual(["Frio", "Retorno", "VIP"]);
  });

  it("devolve vazio quando nenhum lead tem tags", () => {
    expect(computeDistinctLeadTags([{ profile_metadata: {} }])).toEqual([]);
  });
});

type Row = Record<string, unknown>;

function makeBuilder(resultProvider: () => { data: unknown; error: unknown }, captureInsert?: (payload: unknown) => void) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "is", "not", "limit", "order", "update", "delete", "in"];
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
  /** Quantas campanhas ativas o teto já vê — mesmo builder serve a contagem e o insert. */
  activeCampaignCount?: number;
}) {
  return {
    from: (table: string) => {
      if (table === "tenant_agents") return makeBuilder(() => ({ data: options.agentRow, error: null }));
      if (table === "leads") return makeBuilder(() => ({ data: options.leadRows, error: null }));
      if (table === "whatsapp_campaigns") {
        return makeBuilder(
          () => ({ data: options.insertedCampaign, count: options.activeCampaignCount ?? 0, error: null }),
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
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
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
        audienceBlocks: [{ kind: "crm", filter: "all" }],
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
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
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
          audienceBlocks: [{ kind: "crm", filter: "all" }],
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
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
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
          audienceBlocks: [{ kind: "crm", filter: "all" }],
          messageTemplate: "",
          metaTemplateName: "promo_v1",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_meta_template_not_approved");
  });
});

describe("parseCampaignAudienceBlocks", () => {
  it("descarta blocos malformados e mantém os válidos", () => {
    expect(
      parseCampaignAudienceBlocks([
        { kind: "crm", filter: "tag", value: "vip" },
        { kind: "crm", filter: "cadastro_dias", value: "30" },
        { kind: "crm", filter: "cadastro_data", value: "2026-08-19" },
        { kind: "crm", filter: "esquisito" },
        { kind: "leads", leadIds: ["lead-1", "lead-1", "  ", "lead-2"] },
        { kind: "leads", leadIds: [] },
        { kind: "outro" },
        null,
        "string",
      ]),
    ).toEqual([
      { kind: "crm", filter: "tag", value: "vip" },
      { kind: "crm", filter: "cadastro_dias", value: "30" },
      { kind: "crm", filter: "cadastro_data", value: "2026-08-19" },
      { kind: "leads", leadIds: ["lead-1", "lead-2"] },
    ]);
  });

  it("devolve lista vazia quando não é um array", () => {
    expect(parseCampaignAudienceBlocks(undefined)).toEqual([]);
    expect(parseCampaignAudienceBlocks("não é array")).toEqual([]);
  });
});

describe("resolveWhatsAppCampaignAudience", () => {
  it("une bloco de CRM com bloco de leads explícitos sem duplicar quem bate nos dois", async () => {
    let call = 0;
    const sb = {
      from: (table: string) => {
        if (table !== "leads") throw new Error(`unexpected table ${table}`);
        call += 1;
        const rows =
          call === 1
            ? [
                {
                  id: "lead-1",
                  name: "Ana",
                  phone: "5511900000001",
                  status: "novo",
                  profile_metadata: { tags: ["vip"] },
                  whatsapp_opt_in_at: "2026-01-01T00:00:00.000Z",
                  whatsapp_opt_in_source: "crm_manual_confirmation",
                },
              ]
            : [
                {
                  id: "lead-1",
                  name: "Ana",
                  phone: "5511900000001",
                  status: "novo",
                  profile_metadata: { tags: ["vip"] },
                  whatsapp_opt_in_at: "2026-01-01T00:00:00.000Z",
                  whatsapp_opt_in_source: "crm_manual_confirmation",
                },
                {
                  id: "lead-2",
                  name: "Beto",
                  phone: "5511900000002",
                  status: "novo",
                  profile_metadata: {},
                  whatsapp_opt_in_at: "2026-01-01T00:00:00.000Z",
                  whatsapp_opt_in_source: "csv_import",
                },
              ];
        return makeBuilder(() => ({ data: rows, error: null }));
      },
    } as never;

    const result = await resolveWhatsAppCampaignAudience(sb, "tenant-1", [
      { kind: "crm", filter: "tag", value: "vip" },
      { kind: "leads", leadIds: ["lead-1", "lead-2"] },
    ]);

    expect(result.map((row) => row.id).sort()).toEqual(["lead-1", "lead-2"]);
    // Só consulta leads explícitos que ainda não vieram do bloco de CRM.
    expect(call).toBe(2);
  });

  it("não bate no banco de novo quando todo leadId explícito já veio do bloco de CRM", async () => {
    let call = 0;
    const sb = {
      from: () => {
        call += 1;
        return makeBuilder(() => ({
          data: [
            {
              id: "lead-1",
              name: "Ana",
              phone: "5511900000001",
              status: "novo",
              profile_metadata: {},
              whatsapp_opt_in_at: "2026-01-01T00:00:00.000Z",
              whatsapp_opt_in_source: "crm_manual_confirmation",
            },
          ],
          error: null,
        }));
      },
    } as never;

    const result = await resolveWhatsAppCampaignAudience(sb, "tenant-1", [
      { kind: "crm", filter: "all" },
      { kind: "leads", leadIds: ["lead-1"] },
    ]);

    expect(result.map((row) => row.id)).toEqual(["lead-1"]);
    expect(call).toBe(1);
  });

  it("devolve vazio quando não sobra nenhum bloco usável", async () => {
    const sb = { from: () => { throw new Error("não deveria consultar o banco"); } } as never;
    expect(await resolveWhatsAppCampaignAudience(sb, "tenant-1", [])).toEqual([]);
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
          audienceBlocks: [{ kind: "crm", filter: "all" }],
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
          audienceBlocks: [{ kind: "crm", filter: "all" }],
          messageTemplate: "Olá {{nome}}",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_agent_not_available");
  });

  it("aceita um agente de atendimento normal (sem isBroadcastAgent) — a tela de disparos só usa Meus Agentes agora", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "ag-normal-1", active: true, metadata: {} },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    const campaign = await createWhatsAppCampaign({
      sb,
      tenantId: "tenant-1",
      input: {
        name: "Campanha",
        connectionId: "evo-1",
        agentId: "ag-normal-1",
        audienceBlocks: [{ kind: "crm", filter: "all" }],
        messageTemplate: "Olá {{nome}}",
        throughput: "normal",
      },
    });

    expect(campaign).toEqual({ id: "camp-1" });
  });
});

describe("createWhatsAppCampaign — vendedor atribuído", () => {
  beforeEach(() => {
    listTenantWhatsappConnectionsMock.mockReset();
    readTeamMembersFromDbMock.mockReset();
    listTenantWhatsappConnectionsMock.mockResolvedValue([
      { connectionId: "evo-1", transport: "evolution", label: "QR Code", slotIndex: 0, connected: true, activeProvider: "evolution" },
    ]);
  });

  const baseInput = {
    name: "Campanha",
    connectionId: "evo-1",
    agentId: "disparos-default",
    audienceBlocks: [{ kind: "crm" as const, filter: "all" as const }],
    messageTemplate: "Olá {{nome}}",
    throughput: "normal" as const,
  };

  it("rejeita ownerEmployeeId que não existe na equipe do tenant", async () => {
    readTeamMembersFromDbMock.mockResolvedValue([{ id: "emp-outro", nome: "Outro", ativo: true }]);
    const sb = makeSb({
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: { ...baseInput, leadDestination: { ownerAction: "atribuir", ownerEmployeeId: "emp-1" } },
      }),
    ).rejects.toThrow("campaign_owner_employee_invalid");
  });

  it("rejeita funcionário inativo", async () => {
    readTeamMembersFromDbMock.mockResolvedValue([{ id: "emp-1", nome: "Ana", ativo: false }]);
    const sb = makeSb({
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: { ...baseInput, leadDestination: { ownerAction: "atribuir", ownerEmployeeId: "emp-1" } },
      }),
    ).rejects.toThrow("campaign_owner_employee_invalid");
  });

  it("aceita funcionário ativo da equipe e grava no lead_destination", async () => {
    readTeamMembersFromDbMock.mockResolvedValue([{ id: "emp-1", nome: "Ana", ativo: true }]);
    let captured: Row | undefined;
    const sb = makeSb({
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
      captureCampaignInsert: (payload) => {
        captured = payload as Row;
      },
    });

    await createWhatsAppCampaign({
      sb,
      tenantId: "tenant-1",
      input: { ...baseInput, leadDestination: { ownerAction: "atribuir", ownerEmployeeId: "emp-1" } },
    });

    expect((captured?.lead_destination as Row)?.ownerAction).toBe("atribuir");
    expect((captured?.lead_destination as Row)?.ownerEmployeeId).toBe("emp-1");
  });

  it("não consulta a equipe quando ownerAction não é 'atribuir' — não paga o custo à toa", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await createWhatsAppCampaign({
      sb,
      tenantId: "tenant-1",
      input: { ...baseInput, leadDestination: { ownerAction: "soltar" } },
    });

    expect(readTeamMembersFromDbMock).not.toHaveBeenCalled();
  });
});

describe("createWhatsAppCampaign — limite de campanhas ativas", () => {
  beforeEach(() => {
    listTenantWhatsappConnectionsMock.mockReset();
    listTenantWhatsappConnectionsMock.mockResolvedValue([
      { connectionId: "evo-1", transport: "evolution", label: "QR Code", slotIndex: 0, connected: true, activeProvider: "evolution" },
    ]);
  });

  const baseInput = {
    name: "Campanha",
    connectionId: "evo-1",
    agentId: "ag-1",
    audienceBlocks: [{ kind: "crm" as const, filter: "all" as const }],
    messageTemplate: "Olá {{nome}}",
    throughput: "normal" as const,
  };

  it("rejeita a 6ª campanha quando já existem 5 ativas — teto igual pra todos os planos", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "ag-1", active: true, metadata: {} },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-6" },
      activeCampaignCount: 5,
    });

    await expect(createWhatsAppCampaign({ sb, tenantId: "tenant-1", input: baseInput })).rejects.toThrow(
      "campaign_active_limit_reached",
    );
  });

  it("aceita normalmente com 4 ativas (abaixo do teto de 5)", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "ag-1", active: true, metadata: {} },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-5" },
      activeCampaignCount: 4,
    });

    const campaign = await createWhatsAppCampaign({ sb, tenantId: "tenant-1", input: baseInput });
    expect(campaign).toEqual({ id: "camp-5" });
  });

  it("sem nenhuma ativa, aceita normalmente", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "ag-1", active: true, metadata: {} },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
      activeCampaignCount: 0,
    });

    const campaign = await createWhatsAppCampaign({ sb, tenantId: "tenant-1", input: baseInput });
    expect(campaign).toEqual({ id: "camp-1" });
  });
});

describe("createWhatsAppCampaign — público obrigatório", () => {
  beforeEach(() => {
    listTenantWhatsappConnectionsMock.mockReset();
    listTenantWhatsappConnectionsMock.mockResolvedValue([
      { connectionId: "evo-1", transport: "evolution", label: "QR Code", slotIndex: 0, connected: true, activeProvider: "evolution" },
    ]);
  });

  it("rejeita quando nenhum público foi adicionado", async () => {
    const sb = makeSb({
      agentRow: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
      leadRows: [OPTED_IN_LEAD],
      insertedCampaign: { id: "camp-1" },
    });

    await expect(
      createWhatsAppCampaign({
        sb,
        tenantId: "tenant-1",
        input: {
          name: "Campanha",
          connectionId: "evo-1",
          agentId: "agent-1",
          audienceBlocks: [],
          messageTemplate: "Olá {{nome}}",
          throughput: "normal",
        },
      }),
    ).rejects.toThrow("campaign_audience_required");
  });

  it("cria a campanha combinando um bloco de CRM com um bloco de leads explícitos", async () => {
    let captured: Row | undefined;
    let leadsCallCount = 0;
    const sb = {
      from: (table: string) => {
        if (table === "tenant_agents") {
          return makeBuilder(() => ({
            data: { agent_id: "disparos-default", active: true, metadata: { isBroadcastAgent: true } },
            error: null,
          }));
        }
        if (table === "leads") {
          leadsCallCount += 1;
          return makeBuilder(() => ({ data: [OPTED_IN_LEAD], error: null }));
        }
        if (table === "whatsapp_campaigns") {
          return makeBuilder(
            () => ({ data: { id: "camp-1" }, error: null }),
            (payload) => {
              captured = payload as Row;
            },
          );
        }
        if (table === "whatsapp_campaign_recipients") return makeBuilder(() => ({ data: null, error: null }));
        throw new Error(`unexpected table ${table}`);
      },
    } as never;

    const campaign = await createWhatsAppCampaign({
      sb,
      tenantId: "tenant-1",
      input: {
        name: "Campanha combinada",
        connectionId: "evo-1",
        agentId: "agent-1",
        audienceBlocks: [
          { kind: "crm", filter: "all" },
          { kind: "leads", leadIds: ["lead-1"] },
        ],
        messageTemplate: "Olá {{nome}}",
        throughput: "normal",
      },
    });

    expect(campaign).toEqual({ id: "camp-1" });
    expect(leadsCallCount).toBe(1); // lead-1 já veio do bloco de CRM, não repete a consulta
    expect(captured?.audience_type).toBe("custom");
    expect(captured?.audience_blocks).toEqual([
      { kind: "crm", filter: "all", value: null },
      { kind: "leads", leadIds: ["lead-1"] },
    ]);
  });
});
