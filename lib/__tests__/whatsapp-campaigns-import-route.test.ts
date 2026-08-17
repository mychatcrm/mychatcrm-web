import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveClientSessionMock, createSupabaseServiceClientMock } = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: requireActiveClientSessionMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { POST } from "@/app/api/client/whatsapp-campaigns/import/route";

type Row = Record<string, unknown>;

/**
 * Cada chamada a `sb.from("leads")` no handler é independente — o builder
 * descobre se é a consulta de existentes, a inserção ou o opt-in em massa
 * pelo primeiro método encaminhado (select/insert/update).
 */
function makeLeadsTable(options: {
  existingRows: Row[];
  insertedIds: string[];
  onInsert?: (payload: unknown) => void;
  onUpdate?: (payload: unknown, ids: string[]) => void;
}) {
  return () => {
    let mode: "select" | "insert" | "update" | null = null;
    let updatePayload: unknown = null;
    const builder: Record<string, unknown> = {};
    builder.select = () => {
      if (mode === "insert") {
        return Promise.resolve({ data: options.insertedIds.map((id) => ({ id })), error: null });
      }
      mode = "select";
      return builder;
    };
    builder.eq = () => builder;
    builder.in = (_col: string, ids: string[]) => {
      if (mode === "update") {
        options.onUpdate?.(updatePayload, ids);
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ data: options.existingRows, error: null });
    };
    builder.insert = (payload: unknown) => {
      mode = "insert";
      options.onInsert?.(payload);
      return builder;
    };
    builder.update = (payload: unknown) => {
      mode = "update";
      updatePayload = payload;
      return builder;
    };
    return builder;
  };
}

describe("POST /api/client/whatsapp-campaigns/import", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
  });

  it("devolve leadIds combinando inseridos e reaproveitados, na ordem do arquivo", async () => {
    let insertPayload: Row[] | undefined;
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table !== "leads") throw new Error(`unexpected table ${table}`);
        return makeLeadsTable({
          existingRows: [{ id: "lead-existente", phone: "5511988887777", whatsapp_opt_in: false, whatsapp_opt_out_at: null }],
          insertedIds: ["lead-novo"],
          onInsert: (payload) => {
            insertPayload = payload as Row[];
          },
        })();
      },
    });

    const res = await POST(
      new Request("https://example.test/api/client/whatsapp-campaigns/import", {
        method: "POST",
        body: JSON.stringify({ content: "Maria,5511988887777\nJoão,5511977776666" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.reused).toBe(1);
    expect(body.leadIds.sort()).toEqual(["lead-existente", "lead-novo"].sort());
    // Fonte padrão (csv_import) quando `source` não é enviado.
    expect(insertPayload?.[0]?.source).toBe("csv_import");
  });

  it("usa source=manual_entry quando o bloco veio de 'Digitar manualmente'", async () => {
    let insertPayload: Row[] | undefined;
    let updatePayload: Row | undefined;
    createSupabaseServiceClientMock.mockReturnValue({
      from: () =>
        makeLeadsTable({
          existingRows: [],
          insertedIds: ["lead-novo"],
          onInsert: (payload) => {
            insertPayload = payload as Row[];
          },
          onUpdate: (payload) => {
            updatePayload = payload as Row;
          },
        })(),
    });

    const res = await POST(
      new Request("https://example.test/api/client/whatsapp-campaigns/import", {
        method: "POST",
        body: JSON.stringify({ content: "Maria Silva, 62991234567", optIn: true, source: "manual_entry" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.leadIds).toEqual(["lead-novo"]);
    expect(insertPayload?.[0]?.source).toBe("manual_entry");
    expect(updatePayload?.whatsapp_opt_in_source).toBe("manual_entry");
  });

  it("retorna 422 e leadIds implícito vazio quando nenhum telefone é válido", async () => {
    createSupabaseServiceClientMock.mockReturnValue({
      from: () => makeLeadsTable({ existingRows: [], insertedIds: [] })(),
    });

    const res = await POST(
      new Request("https://example.test/api/client/whatsapp-campaigns/import", {
        method: "POST",
        body: JSON.stringify({ content: "sem telefone nenhum aqui" }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Não autenticado." }, { status: 401 }) });
    const res = await POST(
      new Request("https://example.test/api/client/whatsapp-campaigns/import", {
        method: "POST",
        body: JSON.stringify({ content: "5511988887777" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
