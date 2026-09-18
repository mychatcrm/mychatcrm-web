import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyColumn, resolveLeadIdsForOutcomes, resolveLeadOutcomes } from "@/lib/server/meta-lead-outcome";

type Tables = {
  leads?: unknown[];
  agenda_events?: unknown[];
  teams?: unknown[];
  tenant_members?: unknown[];
};

function makeSupabase(tables: Tables) {
  const client = {
    from(table: string) {
      const rows = (tables as Record<string, unknown[] | undefined>)[table] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        not: () => builder,
        order: () => builder,
        in: () => Promise.resolve({ data: rows, error: null }),
        limit: () => Promise.resolve({ data: rows, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      };
      return builder;
    },
  };
  return client as never;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("classifyColumn", () => {
  it("reconhece as colunas do sistema", () => {
    expect(classifyColumn("fechado")).toBe("won");
    expect(classifyColumn("perdido")).toBe("lost");
    expect(classifyColumn("negociacao")).toBe("open");
  });

  it("reconhece coluna de funil personalizado pelo nome", () => {
    expect(classifyColumn("venda-fechada")).toBe("won");
    expect(classifyColumn("lead-desqualificado")).toBe("lost");
  });

  it("coluna ausente é funil aberto", () => {
    expect(classifyColumn(null)).toBe("open");
  });
});

describe("resolveLeadOutcomes", () => {
  it("lead fechado é ganho, mesmo com agendamento", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1",
          phone: "5511999998888",
          status: "fechado",
          crm_funnel_id: "funil-default",
          team_id: null,
          owner_employee_id: null,
          first_reply_at: "2026-09-10T12:00:00Z",
          lead_temperature: "quente",
          created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [{ attendee_phone: "5511999998888", start_at: "2026-09-12T14:00:00Z", status: "confirmed" }],
    });

    const outcomes = await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] });
    expect(outcomes.get("lead-1")?.outcome).toBe("ganho");
  });

  it("agendamento confirmado ganha de 'respondeu'", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "contato", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null, first_reply_at: "2026-09-10T12:00:00Z",
          lead_temperature: null, created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [{ attendee_phone: "5511999998888", start_at: "2026-09-12T14:00:00Z", status: "confirmed" }],
    });

    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.outcome).toBe(
      "agendou",
    );
  });

  it("agendamento cancelado volta para 'respondeu'", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "contato", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null, first_reply_at: "2026-09-10T12:00:00Z",
          lead_temperature: null, created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [{ attendee_phone: "5511999998888", start_at: "2026-09-12T14:00:00Z", status: "cancelled" }],
    });

    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.outcome).toBe(
      "respondeu",
    );
  });

  it("sem resposta e sem agenda é 'sem contato'", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "novo", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null, first_reply_at: null,
          lead_temperature: null, created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [],
    });

    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.outcome).toBe(
      "sem_contato",
    );
  });

  it("calcula os minutos até a primeira resposta", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "contato", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null,
          first_reply_at: "2026-09-10T11:45:00Z", lead_temperature: null,
          created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [],
    });

    expect(
      (await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.firstReplyMinutes,
    ).toBe(45);
  });

  /** O 9º dígito e o DDI aparecem de formas diferentes entre CRM e agenda. */
  it("casa o agendamento pelos últimos dígitos do telefone", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "contato", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null, first_reply_at: null,
          lead_temperature: null, created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [{ attendee_phone: "(11) 99999-8888", start_at: "2026-09-12T14:00:00Z", status: "confirmed" }],
    });

    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.outcome).toBe(
      "agendou",
    );
  });

  it("lista vazia não consulta nada", async () => {
    const sb = makeSupabase({});
    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: [] })).size).toBe(0);
  });

  it("não reporta valor de negócio — o CRM não guarda esse dado hoje", async () => {
    const sb = makeSupabase({
      leads: [
        {
          id: "lead-1", phone: "5511999998888", status: "fechado", crm_funnel_id: "f",
          team_id: null, owner_employee_id: null, first_reply_at: null,
          lead_temperature: null, created_at: "2026-09-10T11:00:00Z",
        },
      ],
      agenda_events: [],
    });

    expect((await resolveLeadOutcomes({ sb, tenantId: "t", leadIds: ["lead-1"] })).get("lead-1")?.value).toBeNull();
  });
});

describe("resolveLeadIdsForOutcomes", () => {
  it("devolve só os leads do desfecho pedido", async () => {
    const sb = makeSupabase({
      leads: [
        { id: "lead-won", phone: "1", status: "fechado", first_reply_at: null },
        { id: "lead-open", phone: "2", status: "contato", first_reply_at: "2026-09-10T12:00:00Z" },
      ],
      agenda_events: [],
    });

    const ids = await resolveLeadIdsForOutcomes({ sb, tenantId: "t", outcomes: ["ganho"] });
    expect(Array.from(ids)).toEqual(["lead-won"]);
  });

  it("sem desfecho escolhido não restringe nada", async () => {
    const sb = makeSupabase({ leads: [] });
    expect((await resolveLeadIdsForOutcomes({ sb, tenantId: "t", outcomes: [] })).size).toBe(0);
  });
});
