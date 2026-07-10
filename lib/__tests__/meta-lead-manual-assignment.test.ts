import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateAgentResponseMock,
  evolutionSendTextMock,
  upsertConversationStateMock,
  resolveAgentCrmFieldsForLeadInsertMock,
  buildNewLeadCrmFieldsMock,
  promoteLeadToContatoOnAgentEngagementMock,
  canAgentAutoContactLeadMock,
  resolveAuthorizedMetaLeadAgentMock,
  resolveLiveEvolutionInstanceByIdForTenantMock,
  activateLeadJourneyMock,
  authorizeActiveJourneyMock,
  isJourneyIsolationEnabledMock,
  touchLeadJourneyMock,
  readTeamMembersFromDbMock,
} = vi.hoisted(() => ({
  generateAgentResponseMock: vi.fn(),
  evolutionSendTextMock: vi.fn(),
  upsertConversationStateMock: vi.fn(),
  resolveAgentCrmFieldsForLeadInsertMock: vi.fn(),
  buildNewLeadCrmFieldsMock: vi.fn(),
  promoteLeadToContatoOnAgentEngagementMock: vi.fn(),
  canAgentAutoContactLeadMock: vi.fn(),
  resolveAuthorizedMetaLeadAgentMock: vi.fn(),
  resolveLiveEvolutionInstanceByIdForTenantMock: vi.fn(),
  activateLeadJourneyMock: vi.fn(),
  authorizeActiveJourneyMock: vi.fn(),
  isJourneyIsolationEnabledMock: vi.fn(),
  touchLeadJourneyMock: vi.fn(),
  readTeamMembersFromDbMock: vi.fn(),
}));

vi.mock("@/lib/ai/generate-agent-response", () => ({
  generateAgentResponse: generateAgentResponseMock,
  isAgentMissingInstructionsResult: () => false,
}));
vi.mock("@/lib/integrations/evolution-api", () => ({
  remoteJidToEvoNumber: (jid: string) => jid.split("@")[0],
}));
vi.mock("@/lib/server/evolution-send-recovery", () => ({
  sendEvolutionTextWithConnectionRecovery: evolutionSendTextMock,
}));
vi.mock("@/lib/server/conversation-memory", () => ({ upsertConversationState: upsertConversationStateMock }));
vi.mock("@/lib/server/auto-lead-upsert", () => ({
  resolveAgentCrmFieldsForLeadInsert: resolveAgentCrmFieldsForLeadInsertMock,
}));
vi.mock("@/lib/server/crm-lead-lifecycle", () => ({
  buildNewLeadCrmFields: buildNewLeadCrmFieldsMock,
  promoteLeadToContatoOnAgentEngagement: promoteLeadToContatoOnAgentEngagementMock,
}));
vi.mock("@/lib/server/agent-auto-contact-guard", () => ({ canAgentAutoContactLead: canAgentAutoContactLeadMock }));
vi.mock("@/lib/server/meta-form-authorization", () => ({
  resolveAuthorizedMetaLeadAgent: resolveAuthorizedMetaLeadAgentMock,
}));
vi.mock("@/lib/server/evolution-instance-reconciliation", () => ({
  resolveLiveEvolutionInstanceByIdForTenant: resolveLiveEvolutionInstanceByIdForTenantMock,
}));
vi.mock("@/lib/server/meta-lead-graph", () => ({
  buildMetaInitialAgentPrompt: () => "prompt",
  sanitizeInitialReply: (t: string) => t,
  buildFallbackInitialMessage: () => "fallback",
}));
vi.mock("@/lib/server/meta-lead-processing", () => ({
  buildWhatsappRemoteJid: (phone: string) => `${phone}@s.whatsapp.net`,
}));
vi.mock("@/lib/server/lead-journeys", () => ({
  activateLeadJourney: activateLeadJourneyMock,
  authorizeActiveJourney: authorizeActiveJourneyMock,
  isJourneyIsolationEnabled: isJourneyIsolationEnabledMock,
  touchLeadJourney: touchLeadJourneyMock,
}));
vi.mock("@/lib/server/team-employees-db", () => ({ readTeamMembersFromDb: readTeamMembersFromDbMock }));

import { assignMetaLeadEventToAgent, assignMetaLeadEventToEmployee } from "@/lib/server/meta-lead-manual-assignment";

type Row = Record<string, unknown>;

function matchesFilters(row: Row, filters: Row): boolean {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}

function makeFakeSupabase(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  let autoId = 1;

  function table(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function selectBuilder(name: string, filters: Row = {}): Row {
    const builder: Row = {
      select: () => builder,
      eq: (col: string, val: unknown) => selectBuilder(name, { ...filters, [col]: val }),
      order: () => builder,
      maybeSingle: async () => ({ data: table(name).find((r) => matchesFilters(r, filters)) ?? null, error: null }),
    };
    return builder;
  }

  function updateBuilder(name: string, patch: Row, filters: Row = {}): Row {
    const apply = () => {
      const rows = table(name).filter((r) => matchesFilters(r, filters));
      for (const row of rows) Object.assign(row, patch);
      return rows;
    };
    const builder: Row = {
      eq: (col: string, val: unknown) => updateBuilder(name, patch, { ...filters, [col]: val }),
      select: () => ({
        maybeSingle: async () => {
          const rows = apply();
          return { data: rows[0] ?? null, error: null };
        },
      }),
      then: (resolve: (v: { data: null; error: null }) => void) => {
        apply();
        resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  function insertBuilder(name: string, payload: Row): Row {
    const row: Row = { id: `${name}-${autoId++}`, ...payload };
    table(name).push(row);
    return {
      select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      then: (resolve: (v: { data: Row; error: null }) => void) => resolve({ data: row, error: null }),
    };
  }

  function upsertBuilder(name: string, payload: Row, opts: { onConflict: string }): Row {
    const conflictCols = opts.onConflict.split(",");
    const rows = table(name);
    const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === payload[c]));
    let row: Row;
    if (idx >= 0) {
      row = { ...rows[idx], ...payload };
      rows[idx] = row;
    } else {
      row = { id: `${name}-${autoId++}`, ...payload };
      rows.push(row);
    }
    return {
      select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      then: (resolve: (v: { data: Row; error: null }) => void) => resolve({ data: row, error: null }),
    };
  }

  return {
    tables,
    from: (name: string) => ({
      select: () => selectBuilder(name),
      update: (patch: Row) => updateBuilder(name, patch),
      insert: (payload: Row) => insertBuilder(name, payload),
      upsert: (payload: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) =>
        upsertBuilder(name, payload, opts),
    }),
  };
}

const TENANT = "tenant-1";
const EVENT: Row = {
  id: "event-1",
  tenant_id: TENANT,
  leadgen_id: "leadgen-1",
  page_id: "page-1",
  form_id: "form-1",
  lead_id: null,
  name: "Fulano",
  phone: "5511999990000",
  email: "fulano@x.com",
  form_name: "Form",
  page_name: "Page",
  campaign_name: null,
  adset_name: null,
  ad_name: null,
  crm_sync_status: "blocked",
  whatsapp_status: "blocked",
  current_step: "skipped_no_agent",
  steps_log: [{ step: "skipped_no_agent", at: "2026-01-01T00:00:00.000Z" }],
  form_fields: [],
  profile_metadata: {},
  error_message: "no_valid_agent",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const ACTIVE_AGENT: Row = { tenant_id: TENANT, agent_id: "agent-1", active: true };

describe("assignMetaLeadEventToAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAgentAutoContactLeadMock.mockResolvedValue({ ok: true, reason: "allowed", leadId: null, formId: null });
    resolveAuthorizedMetaLeadAgentMock.mockResolvedValue({
      authorized: true,
      agentId: "agent-1",
      ruleId: "rule-1",
      connectionId: "connection-1",
      source: "rule",
      reason: "active_rule_explicit_form",
      invalidAgentId: null,
    });
    isJourneyIsolationEnabledMock.mockReturnValue(false);
    activateLeadJourneyMock.mockResolvedValue({ id: "journey-1", status: "active" });
    authorizeActiveJourneyMock.mockResolvedValue({ ok: true, journey: { id: "journey-1" }, agentId: "agent-1" });
    touchLeadJourneyMock.mockResolvedValue(undefined);
    resolveLiveEvolutionInstanceByIdForTenantMock.mockResolvedValue({
      ok: true,
      adoptedSibling: false,
      instance: {
        instance_name: "evo-instance-1",
        connection_state: "open",
      },
    });
    evolutionSendTextMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    generateAgentResponseMock.mockResolvedValue({ ok: true, text: "Olá! Já vou te ajudar.", model: "gpt" });
    upsertConversationStateMock.mockResolvedValue(null);
    promoteLeadToContatoOnAgentEngagementMock.mockResolvedValue(true);
    resolveAgentCrmFieldsForLeadInsertMock.mockResolvedValue({});
    buildNewLeadCrmFieldsMock.mockReturnValue({ status: "novo" });
  });

  it("rejects an inactive/unknown agent without touching the pipeline", async () => {
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT], tenant_agents: [{ agent_id: "agent-1", active: false }] });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(false);
    expect(canAgentAutoContactLeadMock).not.toHaveBeenCalled();
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
  });

  it("surfaces the guard block and leaves the event in error", async () => {
    canAgentAutoContactLeadMock.mockResolvedValue({ ok: false, reason: "agent_inactive", leadId: null, formId: null });
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT], tenant_agents: [ACTIVE_AGENT] });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(false);
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    const stored = sb.tables.meta_lead_events.find((r) => r.id === "event-1");
    expect(stored?.current_step).toBe("skipped_no_agent");
  });

  it("fails before creating a journey when no live authorized connection can be confirmed", async () => {
    resolveLiveEvolutionInstanceByIdForTenantMock.mockResolvedValue({
      ok: false,
      instance: null,
      reason: "connection_not_open",
    });
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT], tenant_agents: [ACTIVE_AGENT] });

    const result = await assignMetaLeadEventToAgent({
      sb: sb as never,
      tenantId: TENANT,
      eventId: "event-1",
      agentId: "agent-1",
    });

    expect(result.ok).toBe(false);
    expect(activateLeadJourneyMock).not.toHaveBeenCalled();
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    const stored = sb.tables.meta_lead_events.find((r) => r.id === "event-1");
    expect(stored?.current_step).toBe("manual_assignment_failed");
  });

  it("on successful send, records manual_assigned_to_agent and fires the post-send side effects", async () => {
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT], tenant_agents: [ACTIVE_AGENT] });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.current_step).toBe("manual_assigned_to_agent");
      expect(result.event.whatsapp_status).toBe("sent");
      expect(result.event.crm_sync_status).toBe("synced");
    }
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
    expect(promoteLeadToContatoOnAgentEngagementMock).toHaveBeenCalledTimes(1);
    expect(upsertConversationStateMock).toHaveBeenCalledTimes(1);
    const lead = sb.tables.leads.find((r) => r.phone === "5511999990000");
    expect(lead?.agent_id).toBe("agent-1");
    expect(lead?.agent_assignment_source).toBe("manual");
  });

  it("does not resend when the initial message already went out from the same agent (race)", async () => {
    const sb = makeFakeSupabase({
      meta_lead_events: [EVENT],
      tenant_agents: [ACTIVE_AGENT],
      whatsapp_messages: [
        { id: "msg-1", tenant_id: TENANT, message_id: "meta:leadgen-1:initial", delivery_status: "sent", agent_id: "agent-1" },
      ],
    });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).not.toHaveBeenCalled();
    expect(generateAgentResponseMock).not.toHaveBeenCalled();
    if (result.ok) expect(result.event.current_step).toBe("manual_assigned_to_agent");
  });

  it("sends a fresh handoff message when redirecting an already-OK lead to a different agent", async () => {
    const sb = makeFakeSupabase({
      meta_lead_events: [{ ...EVENT, current_step: "whatsapp_sent", crm_sync_status: "synced", whatsapp_status: "sent" }],
      tenant_agents: [ACTIVE_AGENT, { tenant_id: TENANT, agent_id: "agent-2", active: true }],
      whatsapp_messages: [
        { id: "msg-1", tenant_id: TENANT, message_id: "meta:leadgen-1:initial", delivery_status: "sent", agent_id: "agent-2" },
      ],
    });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(true);
    expect(evolutionSendTextMock).toHaveBeenCalledTimes(1);
    // A mensagem original (do agente antigo) fica intacta; uma nova linha é criada pro handoff.
    expect(sb.tables.whatsapp_messages).toHaveLength(2);
    const original = sb.tables.whatsapp_messages.find((m) => m.id === "msg-1");
    expect(original?.agent_id).toBe("agent-2");
    const handoff = sb.tables.whatsapp_messages.find((m) => m.id !== "msg-1");
    expect(handoff?.agent_id).toBe("agent-1");
    expect(handoff?.delivery_status).toBe("sent");
  });

  it("reuses the existing failed message row instead of inserting a duplicate", async () => {
    const sb = makeFakeSupabase({
      meta_lead_events: [EVENT],
      tenant_agents: [ACTIVE_AGENT],
      whatsapp_messages: [{ id: "msg-1", tenant_id: TENANT, message_id: "meta:leadgen-1:initial", delivery_status: "failed" }],
    });

    const result = await assignMetaLeadEventToAgent({ sb: sb as never, tenantId: TENANT, eventId: "event-1", agentId: "agent-1" });

    expect(result.ok).toBe(true);
    expect(sb.tables.whatsapp_messages).toHaveLength(1);
    expect(sb.tables.whatsapp_messages[0]?.delivery_status).toBe("sent");
  });
});

describe("assignMetaLeadEventToEmployee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildNewLeadCrmFieldsMock.mockReturnValue({ status: "novo" });
  });

  it("rejects an inactive or suspended employee", async () => {
    readTeamMembersFromDbMock.mockResolvedValue([
      { id: "emp-1", nome: "Vendedor X", email: "x@x.com", funcao: "", initialPassword: "", ativo: false, hierarchyRole: "seller" },
    ]);
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT] });

    const result = await assignMetaLeadEventToEmployee({ sb: sb as never, tenantId: TENANT, eventId: "event-1", employeeId: "emp-1" });

    expect(result.ok).toBe(false);
  });

  it("assigns to any active role (director/manager/seller) and records manual_assigned_to_human", async () => {
    readTeamMembersFromDbMock.mockResolvedValue([
      { id: "dir-1", nome: "Diretor X", email: "d@x.com", funcao: "", initialPassword: "", ativo: true, hierarchyRole: "director" },
    ]);
    const sb = makeFakeSupabase({ meta_lead_events: [EVENT] });

    const result = await assignMetaLeadEventToEmployee({ sb: sb as never, tenantId: TENANT, eventId: "event-1", employeeId: "dir-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.current_step).toBe("manual_assigned_to_human");
      expect(result.event.crm_sync_status).toBe("synced");
    }
    const lead = sb.tables.leads.find((r) => r.phone === "5511999990000");
    expect(lead?.owner_employee_id).toBe("dir-1");
    expect(lead?.agent_assignment_source).toBe("manual");
  });
});
