import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { activateLeadJourneyRpcMock } = vi.hoisted(() => ({
  activateLeadJourneyRpcMock: vi.fn(),
}));

import { resolveDirectJourneyAgent } from "@/lib/server/lead-journeys";

type Row = Record<string, unknown>;

const REMOTE_JID = "5562983411103@s.whatsapp.net";
const CONNECTION_ID = "3553b7fc-conn";

type Updated = { table: string; patch: Row };

/**
 * Supabase falso com o encadeamento que lead-journeys usa: select/eq/order/limit,
 * maybeSingle e update encadeado com eq. Guarda os updates para as asserções.
 */
function makeSupabase(tables: Record<string, Row[]>, updates: Updated[]) {
  const build = (name: string, filters: Row): Record<string, unknown> => {
    const rows = () =>
      (tables[name] ?? []).filter((row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value),
      );
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (key: string, value: unknown) => build(name, { ...filters, [key]: value }),
      in: () => builder,
      order: () => builder,
      limit: async (count: number) => ({ data: rows().slice(0, count), error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
      update: (patch: Row) => {
        // `.or()`/`.is()` existem porque activateLeadJourney limpa jobs
        // pendentes com esses filtros depois de ativar a jornada.
        const applyBuilder: Record<string, unknown> = {
          eq: (key: string, value: unknown) => {
            filters = { ...filters, [key]: value };
            return applyBuilder;
          },
          or: () => applyBuilder,
          is: () => applyBuilder,
          in: () => applyBuilder,
          neq: () => applyBuilder,
          then: (resolve: (value: { error: null }) => unknown) => {
            for (const row of rows()) Object.assign(row, patch);
            updates.push({ table: name, patch });
            return resolve({ error: null });
          },
        };
        return applyBuilder;
      },
    };
    return builder;
  };

  return {
    from: (name: string) => build(name, {}),
    rpc: activateLeadJourneyRpcMock,
  } as never;
}

function directJourney(overrides: Row = {}): Row {
  return {
    id: "journey-antiga",
    tenant_id: "tenant-1",
    remote_jid: REMOTE_JID,
    phone: "5562983411103",
    lead_id: null,
    agent_id: "agente-A",
    rule_id: "regra-1",
    campaign_id: null,
    connection_id: CONNECTION_ID,
    source: "whatsapp_direct",
    source_ref: null,
    page_id: null,
    form_id: null,
    status: "active",
    conflict_policy: "latest_wins",
    started_at: "2026-08-05T15:59:53.000Z",
    last_activity_at: "2026-08-05T15:59:53.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    ended_at: null,
    metadata: {},
    ...overrides,
  };
}

/** Regra ativa apontando para `agentId` na conexão informada. */
function directRule(agentId: string, connectionId = CONNECTION_ID): Row {
  return {
    id: "regra-1",
    tenant_id: "tenant-1",
    active: true,
    source: "whatsapp_organico",
    connection_id: connectionId,
    agent_ids: [agentId],
    distribution_type: "specific_agents",
    order_index: 0,
    conflict_policy: "latest_wins",
    conflict_inactivity_minutes: 1440,
  };
}

function agentRow(agentId: string, active: boolean): Row {
  return {
    tenant_id: "tenant-1",
    agent_id: agentId,
    active,
    metadata: { status: active ? "ativo" : "pausado" },
  };
}

beforeEach(() => {
  vi.stubEnv("OMNICHANNEL_JOURNEYS_ENABLED", "true");
  activateLeadJourneyRpcMock.mockReset();
  activateLeadJourneyRpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== "activate_lead_journey") return { data: null, error: null };
    return {
      data: [
        {
          ...directJourney({
            id: "journey-nova",
            agent_id: args.p_agent_id,
            rule_id: args.p_rule_id,
            connection_id: args.p_connection_id,
            status: "active",
          }),
        },
      ],
      error: null,
    };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDirectJourneyAgent — recuperação quando a configuração muda", () => {
  // Cenário exato de produção (2026-08-05): jornada criada às 15:59:53 no
  // agente A; 5s depois a regra passou a apontar para B. Sem recuperação, o
  // número ficava sem resposta por até 24h.
  it("troca de agente na regra: fecha a jornada velha e ativa a nova no agente atual", async () => {
    const updates: Updated[] = [];
    const journey = directJourney();
    const sb = makeSupabase(
      {
        lead_journeys: [journey],
        lead_distribution_rules: [directRule("agente-B")],
        tenant_agents: [agentRow("agente-A", true), agentRow("agente-B", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.agentId).toBe("agente-B");
    expect(journey.status).toBe("closed");
    expect(updates.some((u) => u.table === "lead_journeys" && u.patch.status === "closed")).toBe(true);
    expect(activateLeadJourneyRpcMock).toHaveBeenCalled();
  });

  it("agente pausado no meio da conversa: recupera quando a regra já aponta para outro ativo", async () => {
    const updates: Updated[] = [];
    const sb = makeSupabase(
      {
        lead_journeys: [directJourney()],
        lead_distribution_rules: [directRule("agente-B")],
        tenant_agents: [agentRow("agente-A", false), agentRow("agente-B", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.agentId).toBe("agente-B");
  });

  // Sem esta guarda, cada mensagem fecharia e recriaria a jornada sem nunca
  // responder — churn puro no banco.
  it("regra ainda aponta para o mesmo agente pausado: bloqueia sem tocar na jornada", async () => {
    const updates: Updated[] = [];
    const journey = directJourney();
    const sb = makeSupabase(
      {
        lead_journeys: [journey],
        lead_distribution_rules: [directRule("agente-A")],
        tenant_agents: [agentRow("agente-A", false)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(journey.status).toBe("active");
    expect(updates.filter((u) => u.patch.status === "closed")).toHaveLength(0);
    expect(activateLeadJourneyRpcMock).not.toHaveBeenCalled();
  });

  it("regra apagada: bloqueia e mantém a jornada intacta", async () => {
    const updates: Updated[] = [];
    const journey = directJourney({ agent_id: "agente-fantasma" });
    const sb = makeSupabase(
      {
        lead_journeys: [journey],
        lead_distribution_rules: [],
        tenant_agents: [agentRow("agente-fantasma", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(journey.status).toBe("active");
    expect(activateLeadJourneyRpcMock).not.toHaveBeenCalled();
  });

  // Jornada de formulário nunca pode ser sequestrada pela regra orgânica.
  it("jornada de outra origem não é recuperada nem fechada", async () => {
    const updates: Updated[] = [];
    const journey = directJourney({ source: "meta_form", page_id: null, form_id: null });
    const sb = makeSupabase(
      {
        lead_journeys: [journey],
        lead_distribution_rules: [directRule("agente-B")],
        tenant_agents: [agentRow("agente-A", true), agentRow("agente-B", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(false);
    expect(journey.status).toBe("active");
    expect(activateLeadJourneyRpcMock).not.toHaveBeenCalled();
  });

  // Segundo bug da mesma família: a jornada expirada já é fechada no banco por
  // authorizeActiveJourney e mesmo assim bloqueava a mensagem que a expirou.
  it("jornada expirada é substituída na mesma chamada", async () => {
    const updates: Updated[] = [];
    const sb = makeSupabase(
      {
        lead_journeys: [directJourney({ expires_at: "2020-01-01T00:00:00.000Z" })],
        lead_distribution_rules: [directRule("agente-A")],
        tenant_agents: [agentRow("agente-A", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.agentId).toBe("agente-A");
  });

  it("mensagem numa linha diferente é persistível, mas não herda a jornada nem o agente", async () => {
    const updates: Updated[] = [];
    const journey = directJourney();
    const sb = makeSupabase(
      {
        lead_journeys: [journey],
        lead_distribution_rules: [directRule("agente-A")],
        tenant_agents: [agentRow("agente-A", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: "outra-linha-conn",
    });

    expect(result).toMatchObject({ ok: false, reason: "journey_connection_mismatch" });
    expect(journey.status).toBe("active");
    expect(activateLeadJourneyRpcMock).not.toHaveBeenCalled();
  });

  it("sem jornada nenhuma, o caminho normal de ativação continua igual", async () => {
    const updates: Updated[] = [];
    const sb = makeSupabase(
      {
        lead_journeys: [],
        lead_distribution_rules: [directRule("agente-A")],
        tenant_agents: [agentRow("agente-A", true)],
      },
      updates,
    );

    const result = await resolveDirectJourneyAgent({
      sb,
      tenantId: "tenant-1",
      remoteJid: REMOTE_JID,
      connectionId: CONNECTION_ID,
    });

    expect(result.ok).toBe(true);
    expect(updates.filter((u) => u.patch.status === "closed")).toHaveLength(0);
  });
});
