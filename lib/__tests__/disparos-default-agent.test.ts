import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClientMock } = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { DISPAROS_DEFAULT_AGENT_ID, ensureDisparosDefaultAgent } from "@/lib/server/disparos-default-agent";

type Row = Record<string, unknown>;

function makeAgentBuilder(params: {
  existingResult: () => { data: unknown; error: unknown };
  createdResult?: () => { data: unknown; error: unknown };
  onUpsert?: (payload: unknown) => void;
}) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.update = () => builder;
  builder.upsert = (payload: unknown) => {
    params.onUpsert?.(payload);
    return builder;
  };
  builder.maybeSingle = async () => params.existingResult();
  builder.single = async () => (params.createdResult ?? params.existingResult)();
  return builder;
}

describe("ensureDisparosDefaultAgent", () => {
  beforeEach(() => {
    createSupabaseServiceClientMock.mockReset();
  });

  it("cria o agente na primeira chamada com o agent_id fixo esperado", async () => {
    let upserted: Row | undefined;
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe("tenant_agents");
        return makeAgentBuilder({
          existingResult: () => ({ data: null, error: null }),
          createdResult: () => ({
            data: { agent_id: DISPAROS_DEFAULT_AGENT_ID, display_name: "Agente do Disparos" },
            error: null,
          }),
          onUpsert: (payload) => {
            upserted = payload as Row;
          },
        });
      },
    });

    const result = await ensureDisparosDefaultAgent("tenant-1");

    expect(result).toEqual({ agentId: DISPAROS_DEFAULT_AGENT_ID, displayName: "Agente do Disparos" });
    expect(upserted?.tenant_id).toBe("tenant-1");
    expect(upserted?.agent_id).toBe(DISPAROS_DEFAULT_AGENT_ID);
    expect(upserted?.active).toBe(true);
  });

  it("reaproveita o agente já existente sem criar de novo (idempotente)", async () => {
    const onUpsert = vi.fn();
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe("tenant_agents");
        return makeAgentBuilder({
          existingResult: () => ({
            data: { agent_id: DISPAROS_DEFAULT_AGENT_ID, display_name: "Agente do Disparos", active: true },
            error: null,
          }),
          onUpsert,
        });
      },
    });

    const result = await ensureDisparosDefaultAgent("tenant-1");

    expect(result).toEqual({ agentId: DISPAROS_DEFAULT_AGENT_ID, displayName: "Agente do Disparos" });
    expect(onUpsert).not.toHaveBeenCalled();
  });
});
