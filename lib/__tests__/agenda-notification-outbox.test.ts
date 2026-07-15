import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueAgendaOwnerNotification,
  META_TEMPLATE_REQUIRED_ERROR,
  processAgendaNotificationOutbox,
  reconcileAgendaOutboxDelivery,
  reconcileMissingAgendaNotifications,
  resolveDeliveryTransition,
  retryBackoffMinutes,
} from "@/lib/server/agenda-notification-outbox";

const sendSystemNotificationMock = vi.fn();
const getSystemAgentMetaConfigMock = vi.fn();

vi.mock("@/lib/server/system-agent", () => ({
  sendSystemNotification: (...args: unknown[]) => sendSystemNotificationMock(...args),
  getSystemAgentMetaConfig: (...args: unknown[]) => getSystemAgentMetaConfigMock(...args),
}));

type Row = Record<string, unknown>;

/**
 * Store em memória mínimo da tabela agenda_notification_outbox + respostas fixas
 * para as tabelas auxiliares. Suporta o subset de operações usadas no módulo.
 */
function makeSb(config: {
  outbox?: Row[];
  tenantPhone?: string | null;
  logStatusByOutboxId?: Record<string, string | null>;
  mutationOps?: Row[];
  agentTimezone?: string | null;
  claimBatch?: Row[];
}) {
  const outbox: Row[] = (config.outbox ?? []).map((r) => ({ ...r }));
  const updates: Array<{ id: unknown; patch: Row }> = [];

  function outboxBuilder() {
    const state: { op?: string; patch?: Row; filters: Row; selected?: boolean } = { filters: {} };
    const b: Record<string, unknown> = {};
    const applyFilter = (k: string, v: unknown) => { state.filters[k] = v; return b; };
    b.select = () => { state.selected = true; return b; };
    b.eq = (k: string, v: unknown) => applyFilter(k, v);
    b.neq = () => b;
    b.lte = (k: string, v: unknown) => applyFilter(`lte_${k}`, v);
    b.lt = () => b;
    b.gte = () => b;
    b.in = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.update = (patch: Row) => { state.op = "update"; state.patch = patch; return b; };
    b.upsert = (row: Row) => { state.op = "upsert"; state.patch = row; return b; };
    b.maybeSingle = async () => {
      if (state.op === "update") {
        const row = outbox.find(
          (r) =>
            r.id === state.filters.id &&
            (state.filters.status === undefined || r.status === state.filters.status) &&
            (state.filters.lte_next_attempt_at === undefined || true) &&
            (state.filters.claim_token === undefined || r.claim_token === state.filters.claim_token),
        );
        if (!row) return { data: null, error: null };
        Object.assign(row, state.patch);
        updates.push({ id: row.id, patch: state.patch! });
        return { data: state.selected ? { ...row } : { id: row.id }, error: null };
      }
      if (state.op === "upsert") {
        const key = (r: Row) =>
          `${r.tenant_id}|${r.operation_key}|${r.action}`;
        const exists = outbox.find((r) => key(r) === key(state.patch!));
        if (exists) return { data: null, error: null }; // ignoreDuplicates
        const created = { id: `outbox-${outbox.length + 1}`, ...state.patch };
        outbox.push(created);
        return { data: { id: created.id }, error: null };
      }
      // select single (existing check)
      const row = outbox.find(
        (r) =>
          (state.filters.tenant_id === undefined || r.tenant_id === state.filters.tenant_id) &&
          (state.filters.operation_key === undefined || r.operation_key === state.filters.operation_key) &&
          (state.filters.action === undefined || r.action === state.filters.action) &&
          (state.filters.id === undefined || r.id === state.filters.id),
      );
      return { data: row ? { ...row } : null, error: null };
    };
    // Awaited diretamente (sem maybeSingle): aplica UPDATE condicionado aos
    // filtros (inclui claim_token), ou resolve a lista de um SELECT.
    b.then = (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      if (state.op === "update") {
        const row = outbox.find(
          (r) =>
            r.id === state.filters.id &&
            (state.filters.status === undefined || r.status === state.filters.status) &&
            (state.filters.claim_token === undefined || r.claim_token === state.filters.claim_token),
        );
        if (row) {
          Object.assign(row, state.patch);
          updates.push({ id: row.id, patch: state.patch! });
        }
        return resolve({ data: null, error: null });
      }
      const rows = outbox.filter((r) => state.filters.status === undefined || r.status === state.filters.status);
      return resolve({ data: rows.map((r) => ({ ...r })), error: null });
    };
    return b;
  }

  const sb = {
    from: (table: string) => {
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { appointment_notification_phone: config.tenantPhone ?? null }, error: null }) }),
          }),
        };
      }
      if (table === "system_notifications_log") {
        return {
          select: () => {
            const st: { outboxId?: string } = {};
            const b: Record<string, unknown> = {};
            b.eq = (k: string, v: unknown) => { if (k === "metadata->>outbox_id") st.outboxId = String(v); return b; };
            b.order = () => b;
            b.limit = () => b;
            b.maybeSingle = async () => ({
              data: st.outboxId && st.outboxId in (config.logStatusByOutboxId ?? {})
                ? { status: config.logStatusByOutboxId![st.outboxId] }
                : null,
              error: null,
            });
            return b;
          },
        };
      }
      if (table === "agenda_mutation_operations") {
        return {
          select: () => {
            const b: Record<string, unknown> = {};
            b.in = () => b; b.gte = () => b; b.order = () => b; b.limit = () => b;
            b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
              resolve({ data: (config.mutationOps ?? []).map((r) => ({ ...r })), error: null });
            return b;
          },
        };
      }
      if (table === "tenant_agents") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: { timezone: config.agentTimezone ?? null } }, error: null }) }) }) }),
        };
      }
      return outboxBuilder();
    },
    rpc: async (name: string) => {
      if (name === "claim_agenda_notifications") {
        const claimed = (config.claimBatch ?? []).map((r) => ({ ...r, claim_token: r.claim_token ?? "batch-token" }));
        return { data: claimed, error: null };
      }
      return { data: null, error: null };
    },
  } as never;

  return { sb, outbox, updates };
}

const ENQUEUE = {
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

function outboxRow(over: Row = {}): Row {
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
    claim_token: null,
    next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    ...over,
  };
}

describe("agenda-notification-outbox — funções puras", () => {
  it("retryBackoffMinutes cresce exponencialmente com teto de 60", () => {
    expect(retryBackoffMinutes(0)).toBe(1);
    expect(retryBackoffMinutes(3)).toBe(8);
    expect(retryBackoffMinutes(10)).toBe(60);
  });

  it("resolveDeliveryTransition: delivered → terminal; sem esperar → aguarda", () => {
    expect(resolveDeliveryTransition({ logStatus: "delivered", attempts: 1, waitElapsed: false })).toEqual({ status: "delivered", retry: false });
    expect(resolveDeliveryTransition({ logStatus: "sent", attempts: 1, waitElapsed: false })).toBeNull();
  });

  it("resolveDeliveryTransition: delivery_failed recuperável → retry; esgotado → failed", () => {
    expect(resolveDeliveryTransition({ logStatus: "delivery_failed", attempts: 1, waitElapsed: false })).toEqual({ status: "pending", retry: true });
    expect(resolveDeliveryTransition({ logStatus: "delivery_failed", attempts: 5, waitElapsed: false })).toEqual({ status: "failed", retry: false });
  });

  it("resolveDeliveryTransition: janela de webhook estourou → reenvio", () => {
    expect(resolveDeliveryTransition({ logStatus: null, attempts: 1, waitElapsed: true })).toEqual({ status: "pending", retry: true });
  });
});

describe("agenda-notification-outbox — enqueue", () => {
  beforeEach(() => {
    getSystemAgentMetaConfigMock.mockResolvedValue(null);
    sendSystemNotificationMock.mockResolvedValue({ ok: true });
  });

  it("enfileira com payload completo quando há telefone", async () => {
    const { sb, outbox } = makeSb({ tenantPhone: "5562990000001" });
    const res = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE });
    expect(res.enqueued).toBe(true);
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]!.payload as { phone: string; message: string };
    expect(payload.phone).toBe("5562990000001");
    expect(payload.message).toContain("Maria");
  });

  it("sem telefone não enfileira", async () => {
    const { sb, outbox } = makeSb({ tenantPhone: null });
    const res = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE });
    expect(res).toEqual({ enqueued: false, outboxId: null });
    expect(outbox).toHaveLength(0);
  });

  it("replay idempotente não duplica", async () => {
    const { sb } = makeSb({ tenantPhone: "5562990000001", outbox: [outboxRow({ operation_key: "op-1", action: "scheduled" })] });
    const res = await enqueueAgendaOwnerNotification({ sb, ...ENQUEUE });
    expect(res).toEqual({ enqueued: false, outboxId: null });
  });

  it("nunca lança com banco indisponível", async () => {
    const throwing = { from: () => { throw new Error("db_down"); } } as never;
    const res = await enqueueAgendaOwnerNotification({ sb: throwing, ...ENQUEUE });
    expect(res).toEqual({ enqueued: false, outboxId: null });
  });
});

describe("agenda-notification-outbox — claim + envio inline", () => {
  beforeEach(() => {
    getSystemAgentMetaConfigMock.mockReset();
    sendSystemNotificationMock.mockReset();
    getSystemAgentMetaConfigMock.mockResolvedValue(null);
    sendSystemNotificationMock.mockResolvedValue({ ok: true, debug: { evolutionMessageId: "wamid-1" } });
  });

  it("aceite do provedor marca sent (NÃO terminal) e guarda provider_message_id", async () => {
    const { sb, outbox } = makeSb({ outbox: [outboxRow()] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(res.sent).toBe(1);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    const row = outbox[0]!;
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).toBe("wamid-1");
    expect(row.claim_token).toBeNull();
    const [phone, message, , options] = sendSystemNotificationMock.mock.calls[0]!;
    expect(phone).toBe("5562990000001");
    expect(String(message)).toContain("Aviso MyChatCRM");
    const md = (options as { metadata: Record<string, unknown> }).metadata;
    expect(md).toMatchObject({ tenant_id: "tenant-1", agenda_event_id: "evt-1", action: "scheduled", operation_key: "op-1", outbox_id: "outbox-1" });
  });

  it("Meta ativo sem template NÃO envia, NÃO marca sent, registra meta_template_required reenviável", async () => {
    getSystemAgentMetaConfigMock.mockResolvedValue({ active: true, templateName: null });
    const { sb, outbox } = makeSb({ outbox: [outboxRow()] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(res.pending).toBe(1);
    expect(outbox[0]!.status).toBe("pending");
    expect(outbox[0]!.last_error).toBe(META_TEMPLATE_REQUIRED_ERROR);
    expect(outbox[0]!.claim_token).toBeNull();
  });

  it("falha de envio mantém pending com attempts e backoff", async () => {
    sendSystemNotificationMock.mockResolvedValue({ ok: false, error: "provider_down" });
    const { sb, outbox } = makeSb({ outbox: [outboxRow()] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(res.pending).toBe(1);
    expect(outbox[0]!.status).toBe("pending");
    expect(outbox[0]!.attempts).toBe(1);
    expect(outbox[0]!.last_error).toBe("provider_down");
  });

  it("esgotar tentativas marca failed", async () => {
    sendSystemNotificationMock.mockResolvedValue({ ok: false, error: "provider_down" });
    const { sb, outbox } = makeSb({ outbox: [outboxRow({ attempts: 4 })] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(res.failed).toBe(1);
    expect(outbox[0]!.status).toBe("failed");
    expect(outbox[0]!.attempts).toBe(5);
  });

  it("payload inválido marca failed sem enviar", async () => {
    const { sb, outbox } = makeSb({ outbox: [outboxRow({ payload: {} })] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(res.failed).toBe(1);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(outbox[0]!.status).toBe("failed");
    expect(outbox[0]!.last_error).toBe("invalid_outbox_payload");
  });

  it("concorrência: uma linha já processing não é reivindicada por outro worker inline", async () => {
    const { sb, outbox } = makeSb({ outbox: [outboxRow({ status: "processing", claim_token: "other-worker" })] });
    const res = await processAgendaNotificationOutbox({ sb, outboxId: "outbox-1" });
    expect(res.processed).toBe(0);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(outbox[0]!.claim_token).toBe("other-worker");
  });
});

describe("agenda-notification-outbox — reconciliadores", () => {
  beforeEach(() => {
    getSystemAgentMetaConfigMock.mockResolvedValue(null);
    sendSystemNotificationMock.mockResolvedValue({ ok: true, debug: { evolutionMessageId: "wamid-1" } });
  });

  it("reconcileMissing recria obrigação ausente a partir de uma mutação confirmada", async () => {
    const { sb, outbox } = makeSb({
      tenantPhone: "5562990000001",
      mutationOps: [
        {
          tenant_id: "tenant-1",
          operation_key: "op-42",
          result: { changed: true, action: "scheduled", event: { id: "evt-42", attendee_name: "João", attendee_phone: "5511988887777", start_at: "2026-06-20T13:00:00.000Z", location: null, agent_id: "ag-1" } },
        },
      ],
    });
    const res = await reconcileMissingAgendaNotifications({ sb });
    expect(res.recreated).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.operation_key).toBe("op-42");
  });

  it("reconcileMissing não recria quando a obrigação já existe (idempotente)", async () => {
    const { sb } = makeSb({
      tenantPhone: "5562990000001",
      outbox: [outboxRow({ id: "outbox-9", operation_key: "op-42", action: "scheduled" })],
      mutationOps: [
        { tenant_id: "tenant-1", operation_key: "op-42", result: { changed: true, action: "scheduled", event: { id: "evt-42", start_at: "2026-06-20T13:00:00.000Z", agent_id: "ag-1" } } },
      ],
    });
    const res = await reconcileMissingAgendaNotifications({ sb });
    expect(res.recreated).toBe(0);
  });

  it("reconcileDelivery promove sent → delivered quando o log confirma entrega", async () => {
    const { sb, outbox } = makeSb({
      outbox: [outboxRow({ status: "sent", updated_at: new Date().toISOString() })],
      logStatusByOutboxId: { "outbox-1": "delivered" },
    });
    const res = await reconcileAgendaOutboxDelivery({ sb });
    expect(res.delivered).toBe(1);
    expect(outbox[0]!.status).toBe("delivered");
  });

  it("reconcileDelivery devolve sent → pending quando o log falhou (recuperável)", async () => {
    const { sb, outbox } = makeSb({
      outbox: [outboxRow({ status: "sent", attempts: 1, updated_at: new Date().toISOString() })],
      logStatusByOutboxId: { "outbox-1": "delivery_failed" },
    });
    const res = await reconcileAgendaOutboxDelivery({ sb });
    expect(res.retried).toBe(1);
    expect(outbox[0]!.status).toBe("pending");
  });
});
