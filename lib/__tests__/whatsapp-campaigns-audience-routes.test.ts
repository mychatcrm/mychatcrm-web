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

import { GET as audiencePreviewGET } from "@/app/api/client/whatsapp-campaigns/audience-preview/route";
import { POST as audienceOptInPOST } from "@/app/api/client/whatsapp-campaigns/audience-opt-in/route";

type Row = Record<string, unknown>;

const LEADS: Row[] = [
  {
    id: "lead-vip-opted",
    status: "novo",
    profile_metadata: { tags: ["vip"] },
    whatsapp_opt_in: true,
    whatsapp_opt_out_at: null,
  },
  {
    id: "lead-vip-not-opted",
    status: "novo",
    profile_metadata: { tags: ["vip"] },
    whatsapp_opt_in: false,
    whatsapp_opt_out_at: null,
  },
  {
    id: "lead-outro-not-opted",
    status: "contato",
    profile_metadata: { tags: ["frio"] },
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

describe("GET /api/client/whatsapp-campaigns/audience-preview", () => {
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

  it("conta certo para público 'todos': todos batem, só quem tem opt-in ativo conta como optedIn", async () => {
    const res = await audiencePreviewGET(new Request("https://example.test/api/client/whatsapp-campaigns/audience-preview?type=all"));
    const body = await res.json();

    expect(body).toEqual({ totalMatched: 3, optedIn: 1, notOptedIn: 2 });
  });

  it("conta certo para público por tag: só os leads com a tag batem", async () => {
    const res = await audiencePreviewGET(
      new Request("https://example.test/api/client/whatsapp-campaigns/audience-preview?type=tag&value=vip"),
    );
    const body = await res.json();

    expect(body).toEqual({ totalMatched: 2, optedIn: 1, notOptedIn: 1 });
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Não autenticado." }, { status: 401 }) });
    const res = await audiencePreviewGET(new Request("https://example.test/api/client/whatsapp-campaigns/audience-preview?type=all"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/client/whatsapp-campaigns/audience-opt-in", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
  });

  it("autoriza só os leads da tag escolhida que ainda não tinham opt-in", async () => {
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
      new Request("https://example.test/api/client/whatsapp-campaigns/audience-opt-in", {
        method: "POST",
        body: JSON.stringify({ audienceType: "tag", audienceValue: "vip" }),
      }),
    );
    const body = await res.json();

    expect(body).toEqual({ ok: true, optedInCount: 1 });
    expect(updatedIds).toEqual(["lead-vip-not-opted"]);
    expect(updatePayload?.whatsapp_opt_in).toBe(true);
    expect(updatePayload?.whatsapp_opt_in_source).toBe("disparos_bulk_opt_in");
  });

  it("não atualiza nada quando todo mundo do público já tem opt-in", async () => {
    const onUpdate = vi.fn();
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "leads") {
          return makeLeadsBuilder(
            [{ id: "lead-vip-opted", status: "novo", profile_metadata: { tags: ["vip"] }, whatsapp_opt_in: true, whatsapp_opt_out_at: null }],
            onUpdate,
          );
        }
        throw new Error(`unexpected table ${table}`);
      },
    });

    const res = await audienceOptInPOST(
      new Request("https://example.test/api/client/whatsapp-campaigns/audience-opt-in", {
        method: "POST",
        body: JSON.stringify({ audienceType: "tag", audienceValue: "vip" }),
      }),
    );
    const body = await res.json();

    expect(body).toEqual({ ok: true, optedInCount: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Não autenticado." }, { status: 401 }) });
    const res = await audienceOptInPOST(
      new Request("https://example.test/api/client/whatsapp-campaigns/audience-opt-in", {
        method: "POST",
        body: JSON.stringify({ audienceType: "all" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
