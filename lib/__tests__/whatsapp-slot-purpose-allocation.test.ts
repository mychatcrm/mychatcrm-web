import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: createSupabaseServiceClientMock }));
// resolveOrAllocateSlotForPurpose só usa as funções server-side deste próprio
// módulo (getSlotPurposesForTenant, setSlotPurpose) — sem mocks cruzados.

import { resolveOrAllocateSlotForPurpose } from "@/lib/server/whatsapp-slot-provider";

type Row = Record<string, unknown>;

/**
 * Supabase falso cobrindo as 3 tabelas que a alocação toca:
 * tenant_whatsapp_slot_state (purpose + upsert), tenant_evolution_instances e
 * whatsapp_cloud_connections (só pra saber quais linhas já têm número vivo).
 */
function makeSb(seed: { slotState?: Row[]; evoInstances?: Row[]; cloudConnections?: Row[] }) {
  const slotState = seed.slotState ?? [];
  const evoInstances = seed.evoInstances ?? [];
  const cloudConnections = seed.cloudConnections ?? [];

  function readOnlyTable(rows: Row[], filters: Row = {}): Record<string, unknown> {
    const matches = () => rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (key: string, value: unknown) => readOnlyTable(rows, { ...filters, [key]: value }),
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: matches(), error: null }),
    };
    return builder;
  }

  function slotStateTable(filters: Row = {}): Record<string, unknown> {
    const matches = () => slotState.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (key: string, value: unknown) => slotStateTable({ ...filters, [key]: value }),
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: matches(), error: null }),
      upsert: (payload: Row) => {
        const idx = slotState.findIndex((r) => r.tenant_id === payload.tenant_id && r.slot_index === payload.slot_index);
        if (idx >= 0) slotState[idx] = { ...slotState[idx], ...payload };
        else slotState.push({ ...payload });
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  }

  return {
    from: (table: string) => {
      if (table === "tenant_whatsapp_slot_state") return slotStateTable();
      if (table === "tenant_evolution_instances") return readOnlyTable(evoInstances);
      if (table === "whatsapp_cloud_connections") return readOnlyTable(cloudConnections);
      throw new Error(`unexpected table ${table}`);
    },
    _slotState: slotState,
  };
}

beforeEach(() => {
  createSupabaseServiceClientMock.mockReset();
});

describe("resolveOrAllocateSlotForPurpose", () => {
  it("reusa a linha que já tem essa finalidade, em vez de abrir uma nova", async () => {
    const sb = makeSb({
      slotState: [{ tenant_id: "t1", slot_index: 1, active_provider: "evolution", purpose: "direct" }],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "direct", totalSlots: 2 });

    expect(result).toEqual({ ok: true, slotIndex: 1, isNewSlot: false });
  });

  it("aloca a menor linha livre (sem finalidade e sem número conectado) quando não há nenhuma da finalidade pedida", async () => {
    const sb = makeSb({
      slotState: [{ tenant_id: "t1", slot_index: 0, active_provider: "evolution", purpose: "forms" }],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "direct", totalSlots: 2 });

    expect(result).toEqual({ ok: true, slotIndex: 1, isNewSlot: true });
    expect(sb._slotState.find((r) => r.slot_index === 1)).toMatchObject({ purpose: "direct" });
  });

  it("não reaproveita uma linha livre que já tem número conectado (fica pra resolução manual)", async () => {
    const sb = makeSb({
      slotState: [{ tenant_id: "t1", slot_index: 0, active_provider: "evolution", purpose: null }],
      evoInstances: [{ tenant_id: "t1", slot_index: 0, connection_state: "open" }],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "forms", totalSlots: 1 });

    expect(result).toEqual({ ok: false, reason: "no_capacity" });
  });

  it("pula linha com número Cloud API ativo mesmo sem finalidade travada", async () => {
    const sb = makeSb({
      slotState: [],
      cloudConnections: [{ tenant_id: "t1", slot_index: 0, active: true }],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "forms", totalSlots: 1 });

    expect(result).toEqual({ ok: false, reason: "no_capacity" });
  });

  it("nunca aloca uma linha que já tem a finalidade oposta travada", async () => {
    const sb = makeSb({
      slotState: [{ tenant_id: "t1", slot_index: 0, active_provider: "evolution", purpose: "forms" }],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "direct", totalSlots: 1 });

    expect(result).toEqual({ ok: false, reason: "no_capacity" });
  });

  it("devolve no_capacity quando a capacidade do plano já está toda ocupada", async () => {
    const sb = makeSb({
      slotState: [
        { tenant_id: "t1", slot_index: 0, active_provider: "evolution", purpose: "forms" },
        { tenant_id: "t1", slot_index: 1, active_provider: "evolution", purpose: "direct" },
      ],
    });
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "forms", totalSlots: 2 });

    // já existe forms no slot 0 — devolve ele, não fica sem capacidade.
    expect(result).toEqual({ ok: true, slotIndex: 0, isNewSlot: false });
  });

  it("linha nova (do zero, tenant sem nenhum registro) aloca o slot 0", async () => {
    const sb = makeSb({});
    createSupabaseServiceClientMock.mockReturnValue(sb);

    const result = await resolveOrAllocateSlotForPurpose({ tenantId: "t1", purpose: "forms", totalSlots: 2 });

    expect(result).toEqual({ ok: true, slotIndex: 0, isNewSlot: true });
  });
});
