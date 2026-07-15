import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueAgendaOwnerNotification,
  META_TEMPLATE_REQUIRED_ERROR,
  processAgendaNotificationOutbox,
} from "@/lib/server/agenda-notification-outbox";

const sendSystemNotificationMock = vi.fn();
const getSystemAgentMetaConfigMock = vi.fn();

vi.mock("@/lib/server/system-agent", () => ({
  sendSystemNotification: (...args: unknown[]) => sendSystemNotificationMock(...args),
  getSystemAgentMetaConfig: (...args: unknown[]) => getSystemAgentMetaConfigMock(...args),
}));

type FakeOutboxRow = {
  id: string;
  tenant_id: string;
  agenda_event_id: string | null;
  action: "scheduled" | "rescheduled" | "cancelled";
  operation_key: string;
  phone_last4: string | null;
  payload: { phone?: string; message?: string; agent_id?: string | null } | null;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
};

function makeFakeSb(options: {
  phone?: string | null;
  upsertResult?: { id: string } | null;
  rows?: FakeOutboxRow[];
}) {
  const upserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string | null; patch: Record<string, unknown> }> = [];
  const sb = {
    from: (table: string) => {
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { appointment_notification_phone: options.phone ?? null },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: options.upsertResult === undefined ? { id: "outbox-1" } : options.upsertResult,
                error: null,
              }),
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          const entry = { id: null as string | null, patch };
          updates.push(entry);
          return {
            eq: async (_col: string, value: string) => {
              entry.id = value;
              return { error: null };
            },
          };
        },
        select: () => {
          const chain = {
            eq: () => chain,
            lt: () => chain,
            order: () => chain,
            limit: () => chain,
            then: (resolve: (value: { data: FakeOutboxRow[]; error: null }) => unknown) =>
              resolve({ data: options.rows ?? [], error: null }),
          };
          return chain;
        },
      };
    },
  } as never;
  return { sb, upserts, updates };
}

function makeRow(overrides: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
  return {
    id: "outbox-1",
    tenant_id: "tenant-1",
    agenda_event_id: "evt-1",
    action: "scheduled",
    operation_key: "op-1",
    phone_last4: "0001",
    payload: { phone: "5562990000001", message: "Aviso MyChatCRM — Novo agendamento confirmado pelo agente.", agent_id: "ag-1" },
    status: "pending",
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

const ENQUEUE_PARAMS = {
  tenantId: "tenant-1",
  agendaEventId: "evt-1",
  action: "scheduled" as const,
  operationKey: "op-1",
  attendeeName: "Maria",
  attendeePhone: "5511999999999",
  startAtIso: "2026-06-10T17:00:00.000Z",
  location: null,
  timezone: "America/Sao_Paulo",
  agentId: "ag-1",
};

describe("agenda-notification-outbox", () => {
  beforeEach(() => {
    sendSystemNotificationMock.mockReset();
    getSystemAgentMetaConfigMock.mockReset();
    getSystemAgentMetaConfigMock.mockResolvedValue(null);
    sendSystemNotificationMock.mockResolvedValue({ ok: true });
  });

  it("enfileira uma notificação com payload completo quando o telefone está configurado", async () => {
    const { sb, upserts } = makeFakeSb({ phone: "5562990000001" });
    const result = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE_PARAMS });

    expect(result).toEqual({ enqueued: true, outboxId: "outbox-1" });
    expect(upserts).toHaveLength(1);
    const row = upserts[0]!;
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.operation_key).toBe("op-1");
    expect(row.action).toBe("scheduled");
    expect(row.status).toBe("pending");
    expect(row.phone_last4).toBe("0001");
    const payload = row.payload as { phone: string; message: string };
    expect(payload.phone).toBe("5562990000001");
    expect(payload.message).toContain("Aviso MyChatCRM");
    expect(payload.message).toContain("Maria");
  });

  it("não enfileira sem telefone configurado", async () => {
    const { sb, upserts } = makeFakeSb({ phone: null });
    const result = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE_PARAMS });
    expect(result).toEqual({ enqueued: false, outboxId: null });
    expect(upserts).toHaveLength(0);
  });

  it("replay idempotente não duplica (conflito na chave única)", async () => {
    const { sb, upserts } = makeFakeSb({ phone: "5562990000001", upsertResult: null });
    const result = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE_PARAMS });
    expect(result).toEqual({ enqueued: false, outboxId: null });
    expect(upserts).toHaveLength(1);
  });

  it("nunca lança mesmo com banco indisponível", async () => {
    const throwingSb = {
      from: () => {
        throw new Error("db_down");
      },
    } as never;
    const result = await enqueueAgendaOwnerNotification({ sb: throwingSb, ...ENQUEUE_PARAMS });
    expect(result).toEqual({ enqueued: false, outboxId: null });
  });

  it("Meta ativo sem template NÃO envia, NÃO marca sent e registra meta_template_required", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValue({ active: true, templateName: null });
    const { sb, updates } = makeFakeSb({ rows: [makeRow()] });

    const result = await processAgendaNotificationOutbox({ sb });

    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
    expect(result.sent).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch.last_error).toBe(META_TEMPLATE_REQUIRED_ERROR);
    expect(updates[0]!.patch.status).toBeUndefined();
  });

  it("envio ok marca sent com metadata completa e sem telefone completo nos patches", async () => {
    const { sb, updates } = makeFakeSb({ rows: [makeRow()] });

    const result = await processAgendaNotificationOutbox({ sb });

    expect(result.sent).toBe(1);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    const [phone, message, , options] = sendSystemNotificationMock.mock.calls[0]!;
    expect(phone).toBe("5562990000001");
    expect(String(message)).toContain("Aviso MyChatCRM");
    const metadata = (options as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.tenant_id).toBe("tenant-1");
    expect(metadata.agenda_event_id).toBe("evt-1");
    expect(metadata.action).toBe("scheduled");
    expect(metadata.operation_key).toBe("op-1");
    expect(updates[0]!.patch).toMatchObject({ status: "sent", attempts: 1, last_error: null });
    expect(JSON.stringify(updates[0]!.patch)).not.toContain("5562990000001");
  });

  it("falha de envio mantém pending com attempts e erro observável", async () => {
    sendSystemNotificationMock.mockResolvedValue({ ok: false, error: "provider_down" });
    const { sb, updates } = makeFakeSb({ rows: [makeRow()] });

    const result = await processAgendaNotificationOutbox({ sb });

    expect(result.pending).toBe(1);
    expect(updates[0]!.patch).toMatchObject({ status: "pending", attempts: 1, last_error: "provider_down" });
  });

  it("esgotar tentativas marca failed", async () => {
    sendSystemNotificationMock.mockResolvedValue({ ok: false, error: "provider_down" });
    const { sb, updates } = makeFakeSb({ rows: [makeRow({ attempts: 4 })] });

    const result = await processAgendaNotificationOutbox({ sb });

    expect(result.failed).toBe(1);
    expect(updates[0]!.patch).toMatchObject({ status: "failed", attempts: 5 });
  });

  it("payload inválido marca failed sem tentar enviar", async () => {
    const { sb, updates } = makeFakeSb({ rows: [makeRow({ payload: {} })] });

    const result = await processAgendaNotificationOutbox({ sb });

    expect(result.failed).toBe(1);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(updates[0]!.patch).toMatchObject({ status: "failed", last_error: "invalid_outbox_payload" });
  });
});
