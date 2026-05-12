import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClientMock } = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import {
  buildWhatsAppLeadInsertPayload,
  normalizeWhatsAppPhone,
  phoneFromRemoteJid,
  upsertLeadFromWhatsAppContact,
} from "@/lib/server/auto-lead-upsert";

type DbResult<T = unknown> = { data: T | null; error: { code?: string; message?: string } | null };

type Operation =
  | { table: string; type: "insert"; payload: Record<string, unknown> }
  | { table: string; type: "update"; patch: Record<string, unknown>; eqs: Array<[string, unknown]> };

function makeSupabaseMock(opts: {
  leadSelects?: Array<DbResult<Record<string, unknown>>>;
  agentRow?: Record<string, unknown> | null;
  insertError?: { code?: string; message?: string } | null;
}) {
  const operations: Operation[] = [];
  const leadSelects = [...(opts.leadSelects ?? [])];

  const client = {
    from(table: string) {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            order() {
              return chain;
            },
            limit() {
              return chain;
            },
            maybeSingle: async () => {
              if (table === "leads") {
                return leadSelects.shift() ?? { data: null, error: null };
              }
              if (table === "tenant_agents") {
                return { data: opts.agentRow ?? null, error: null };
              }
              return { data: null, error: null };
            },
            then(resolve: (value: DbResult<unknown[]>) => void) {
              resolve({ data: null, error: null });
            },
          };
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          operations.push({ table, type: "insert", payload });
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        update(patch: Record<string, unknown>) {
          const op: Operation = { table, type: "update", patch, eqs: [] };
          operations.push(op);
          const chain = {
            error: null,
            eq(key: string, value: unknown) {
              if (op.type === "update") op.eqs.push([key, value]);
              return chain;
            },
          };
          return chain;
        },
      };
    },
  };

  return { client, operations };
}

describe("phoneFromRemoteJid", () => {
  beforeEach(() => {
    createSupabaseServiceClientMock.mockReset();
  });

  it("extracts only digits from WhatsApp remoteJid", () => {
    expect(phoneFromRemoteJid("55 11 99999-0000@s.whatsapp.net")).toBe("5511999990000");
  });

  it("returns an empty string for empty input", () => {
    expect(phoneFromRemoteJid("")).toBe("");
  });

  it("normalizes a plain WhatsApp phone number", () => {
    expect(normalizeWhatsAppPhone("+55 (11) 99999-0000")).toBe("5511999990000");
  });

  it("builds a WhatsApp lead payload without localStorage-only fields", () => {
    const payload = buildWhatsAppLeadInsertPayload({
      tenantId: "tenant-a",
      phone: "5511999990000",
      contactName: "Maria Cliente",
      status: "novo",
      agentId: "ag-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(payload).toEqual({
      tenant_id: "tenant-a",
      phone: "5511999990000",
      name: "Maria Cliente",
      source: "whatsapp",
      status: "novo",
      agent_id: "ag-vendas",
      last_seen: "2026-05-12T10:00:00.000Z",
      last_message_at: "2026-05-12T10:00:00.000Z",
      created_at: "2026-05-12T10:00:00.000Z",
      updated_at: "2026-05-12T10:00:00.000Z",
    });
  });

  it("can include CRM funnel destination in a WhatsApp lead payload", () => {
    const payload = buildWhatsAppLeadInsertPayload({
      tenantId: "tenant-a",
      phone: "5511999990000",
      status: "qualificado",
      crmFunnelId: "funil-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(payload.status).toBe("qualificado");
    expect(payload.crm_funnel_id).toBe("funil-vendas");
  });

  it("does not touch the database for an empty phone", async () => {
    await upsertLeadFromWhatsAppContact({ tenantId: "tenant-a", phone: "" });
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("does not touch the database for a short phone", async () => {
    await upsertLeadFromWhatsAppContact({ tenantId: "tenant-a", phone: "1234567" });
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("does not touch the database for a WhatsApp group remoteJid", async () => {
    await upsertLeadFromWhatsAppContact({
      tenantId: "tenant-a",
      remoteJid: "5511999990000-123456789@g.us",
    });
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("re-selects and updates the existing lead after a tenant/phone duplicate conflict", async () => {
    const { client, operations } = makeSupabaseMock({
      leadSelects: [
        { data: null, error: null },
        {
          data: {
            id: "lead-1",
            tenant_id: "tenant-a",
            phone: "5511999990000",
            name: null,
            source: "manual",
            agent_id: null,
            last_seen: null,
            last_message_at: null,
            updated_at: null,
          },
          error: null,
        },
      ],
      insertError: { code: "23505", message: "duplicate key" },
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    await upsertLeadFromWhatsAppContact({
      tenantId: "tenant-a",
      phone: "5511999990000",
      contactName: "Maria Cliente",
      agentId: "ag-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(operations).toContainEqual(expect.objectContaining({ table: "leads", type: "insert" }));
    expect(operations).toContainEqual({
      table: "leads",
      type: "update",
      patch: {
        last_seen: "2026-05-12T10:00:00.000Z",
        last_message_at: "2026-05-12T10:00:00.000Z",
        updated_at: "2026-05-12T10:00:00.000Z",
        source: "whatsapp",
        agent_id: "ag-vendas",
        name: "Maria Cliente",
      },
      eqs: [
        ["tenant_id", "tenant-a"],
        ["id", "lead-1"],
      ],
    });
  });

  it("creates a lead without moving CRM status when the agent is configured not to move", async () => {
    const { client, operations } = makeSupabaseMock({
      leadSelects: [{ data: null, error: null }],
      agentRow: {
        metadata: { crmAutoMoveEnabled: false },
      },
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    await upsertLeadFromWhatsAppContact({
      tenantId: "tenant-a",
      phone: "5511999990000",
      agentId: "ag-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(operations).toContainEqual({
      table: "leads",
      type: "insert",
      payload: expect.objectContaining({
        tenant_id: "tenant-a",
        phone: "5511999990000",
        status: "novo",
      }),
    });
    expect((operations[0] as Extract<Operation, { type: "insert" }>).payload.crm_funnel_id).toBeUndefined();
  });

  it("creates a lead in the configured CRM funnel and column when the agent has a destination", async () => {
    const { client, operations } = makeSupabaseMock({
      leadSelects: [{ data: null, error: null }],
      agentRow: {
        metadata: {
          crmAutoMoveEnabled: true,
          crmTargetFunnelId: "funil-vendas",
          crmTargetColumnId: "qualificado",
        },
      },
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    await upsertLeadFromWhatsAppContact({
      tenantId: "tenant-a",
      phone: "5511999990000",
      agentId: "ag-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(operations).toContainEqual({
      table: "leads",
      type: "insert",
      payload: expect.objectContaining({
        tenant_id: "tenant-a",
        phone: "5511999990000",
        status: "qualificado",
        crm_funnel_id: "funil-vendas",
        agent_id: "ag-vendas",
      }),
    });
  });

  it("does not move an existing lead when the agent CRM destination is incomplete", async () => {
    const { client, operations } = makeSupabaseMock({
      leadSelects: [
        {
          data: {
            id: "lead-1",
            tenant_id: "tenant-a",
            phone: "5511999990000",
            name: "Maria",
            source: "manual",
            agent_id: null,
            last_seen: null,
            last_message_at: null,
            updated_at: null,
            status: "novo",
            crm_funnel_id: "funil-default",
          },
          error: null,
        },
      ],
      agentRow: {
        metadata: {
          crmAutoMoveEnabled: true,
          crmTargetFunnelId: "funil-vendas",
        },
      },
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    await upsertLeadFromWhatsAppContact({
      tenantId: "tenant-a",
      phone: "5511999990000",
      agentId: "ag-vendas",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(operations).toContainEqual({
      table: "leads",
      type: "update",
      patch: expect.not.objectContaining({
        status: expect.any(String),
        crm_funnel_id: expect.any(String),
      }),
      eqs: [
        ["tenant_id", "tenant-a"],
        ["id", "lead-1"],
      ],
    });
  });

  it("keeps tenant_id in the insert payload so different tenants can share a phone", async () => {
    const first = buildWhatsAppLeadInsertPayload({
      tenantId: "tenant-a",
      phone: "5511999990000",
      status: "novo",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });
    const second = buildWhatsAppLeadInsertPayload({
      tenantId: "tenant-b",
      phone: "5511999990000",
      status: "novo",
      occurredAt: "2026-05-12T10:00:00.000Z",
    });

    expect(first.phone).toBe(second.phone);
    expect(first.tenant_id).toBe("tenant-a");
    expect(second.tenant_id).toBe("tenant-b");
  });
});
