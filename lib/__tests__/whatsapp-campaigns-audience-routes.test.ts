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

import { POST as audiencePreviewPOST } from "@/app/api/client/whatsapp-campaigns/audience-preview/route";
import { POST as audienceOptInPOST } from "@/app/api/client/whatsapp-campaigns/audience-opt-in/route";

type Row = Record<string, unknown>;

const LEADS: Row[] = [
  {
    id: "lead-vendas-opted",
    crm_funnel_id: "funil-vendas",
    status: "novo",
    whatsapp_opt_in: true,
    whatsapp_opt_out_at: null,
  },
  {
    id: "lead-vendas-not-opted",
    crm_funnel_id: "funil-vendas",
    status: "novo",
    whatsapp_opt_in: false,
    whatsapp_opt_out_at: null,
  },
  {
    id: "lead-pos-not-opted",
    crm_funnel_id: "funil-pos",
    status: "contato",
    whatsapp_opt_in: false,
    whatsapp_opt_out_at: null,
  },
];

function makeLeadsBuilder(rows: Row[], onUpdate?: (payload: unknown, ids: string[]) => void) {
  let pendingUpdatePayload: unknown = null;
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.not = () => builder;
  builder.limit = () => builder;
  builder.update = (payload: unknown) => {
    pendingUpdatePayload = payload;
    return builder;
  };
  builder.in = (_col: string, ids: string[]) => {
    onUpdate?.(pendingUpdatePayload, ids);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return builder;
}

function jsonRequest(url: string, body: unknown) {
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { timezone: "UTC", ...(body as Record<string, unknown>) }
    : body;
  return new Request(url, { method: "POST", body: JSON.stringify(payload) });
}

const PREVIEW_URL = "https://example.test/api/client/whatsapp-campaigns/audience-preview";
const OPT_IN_URL = "https://example.test/api/client/whatsapp-campaigns/audience-opt-in";

describe("POST /api/client/whatsapp-campaigns/audience-preview", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "leads") return makeLeadsBuilder(LEADS.map((r) => ({ ...r })));
        throw new Error(`unexpected table ${table}`);
      },
    });
  });

  it("escopo vazio = base inteira; só quem tem opt-in ativo conta como optedIn", async () => {
    const res = await audiencePreviewPOST(jsonRequest(PREVIEW_URL, {}));
    expect(await res.json()).toEqual({ totalMatched: 3, optedIn: 1, notOptedIn: 2 });
  });

  it("recorta por funil escolhido", async () => {
    const res = await audiencePreviewPOST(
      jsonRequest(PREVIEW_URL, { scope: { funnelIds: ["funil-vendas"], columns: [] }, period: { mode: "all" } }),
    );
    expect(await res.json()).toEqual({ totalMatched: 2, optedIn: 1, notOptedIn: 1 });
  });

  it("recorta por coluna escolhida de um funil específico", async () => {
    const res = await audiencePreviewPOST(
      jsonRequest(PREVIEW_URL, {
        scope: { funnelIds: [], columns: [{ funnelId: "funil-pos", columnId: "contato" }] },
        period: { mode: "all" },
      }),
    );
    expect(await res.json()).toEqual({ totalMatched: 1, optedIn: 0, notOptedIn: 1 });
  });

  it("BUG real corrigido: a mesma coluna de OUTRO funil não entra no recorte", async () => {
    const res = await audiencePreviewPOST(
      jsonRequest(PREVIEW_URL, {
        scope: { funnelIds: [], columns: [{ funnelId: "funil-vendas", columnId: "contato" }] },
        period: { mode: "all" },
      }),
    );
    // "contato" só existe no funil-pos nesta fixture — pedir a coluna "contato"
    // do funil-vendas não pode bater em ninguém.
    expect(await res.json()).toEqual({ totalMatched: 0, optedIn: 0, notOptedIn: 0 });
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });
    const res = await audiencePreviewPOST(jsonRequest(PREVIEW_URL, {}));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/client/whatsapp-campaigns/audience-opt-in", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
  });

  it("autoriza só os leads do escopo escolhido que ainda não tinham opt-in", async () => {
    let updatePayload: Row | undefined;
    let updatedIds: string[] = [];
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "leads") {
          return makeLeadsBuilder(LEADS.map((r) => ({ ...r })), (payload, ids) => {
            updatePayload = payload as Row;
            updatedIds = ids;
          });
        }
        throw new Error(`unexpected table ${table}`);
      },
    });

    const res = await audienceOptInPOST(
      jsonRequest(OPT_IN_URL, { scope: { funnelIds: ["funil-vendas"], columns: [] }, period: { mode: "all" } }),
    );

    expect(await res.json()).toEqual({ ok: true, optedInCount: 1 });
    expect(updatedIds).toEqual(["lead-vendas-not-opted"]);
    expect(updatePayload?.whatsapp_opt_in).toBe(true);
    expect(updatePayload?.whatsapp_opt_in_source).toBe("disparos_bulk_opt_in");
  });

  it("não atualiza nada quando todo mundo do público já tem opt-in", async () => {
    const onUpdate = vi.fn();
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "leads") {
          return makeLeadsBuilder(
            [
              {
                id: "lead-vendas-opted",
                crm_funnel_id: "funil-vendas",
                status: "novo",
                whatsapp_opt_in: true,
                whatsapp_opt_out_at: null,
              },
            ],
            onUpdate,
          );
        }
        throw new Error(`unexpected table ${table}`);
      },
    });

    const res = await audienceOptInPOST(jsonRequest(OPT_IN_URL, {}));

    expect(await res.json()).toEqual({ ok: true, optedInCount: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });
    const res = await audienceOptInPOST(jsonRequest(OPT_IN_URL, {}));
    expect(res.status).toBe(401);
  });
});
