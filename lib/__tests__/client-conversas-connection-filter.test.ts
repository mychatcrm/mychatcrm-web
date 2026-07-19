import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientSessionFromCookiesMock, createSupabaseServiceClientMock } = vi.hoisted(() => ({
  getClientSessionFromCookiesMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/client-auth-server", () => ({
  getClientSessionFromCookies: getClientSessionFromCookiesMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { GET } from "@/app/api/client/conversas/route";

type Row = Record<string, unknown>;

function makeQueryBuilder(initialData: Row[]) {
  let data = initialData;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      data = data.filter((row) => row[col] === val);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data, error: null }),
  };
  return builder;
}

const MESSAGES: Row[] = [
  {
    remote_jid: "5511999990000@s.whatsapp.net",
    content: "oi da linha A",
    kind: "text",
    direction: "inbound",
    created_at: "2026-07-01T10:00:00.000Z",
    tenant_id: "tenant-1",
    connection_id: "conn-a",
  },
  {
    remote_jid: "5511888880000@s.whatsapp.net",
    content: "oi da linha B",
    kind: "text",
    direction: "inbound",
    created_at: "2026-07-01T11:00:00.000Z",
    tenant_id: "tenant-1",
    connection_id: "conn-b",
  },
];

describe("GET /api/client/conversas — filtro por connectionId", () => {
  beforeEach(() => {
    getClientSessionFromCookiesMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-1" });
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === "whatsapp_messages") return makeQueryBuilder(MESSAGES.map((row) => ({ ...row })));
        if (table === "conversation_states") return makeQueryBuilder([]);
        if (table === "leads") return makeQueryBuilder([]);
        throw new Error(`unexpected table ${table}`);
      },
      // RPC não implementado neste mock — a rota já tem fallback pro scan
      // direto em whatsapp_messages quando o RPC falha (mesmo caminho usado
      // em produção antes da função list_tenant_inbox_conversations existir).
      rpc: () => Promise.resolve({ data: null, error: { message: "rpc not mocked" } }),
    });
  });

  it("mantém todas as linhas quando connectionId não é informado", async () => {
    const res = await GET(new Request("https://example.test/api/client/conversas"));
    const body = (await res.json()) as { conversations: { remoteJid: string }[] };

    expect(body.conversations.map((c) => c.remoteJid).sort()).toEqual([
      "5511888880000@s.whatsapp.net",
      "5511999990000@s.whatsapp.net",
    ]);
  });

  it("filtra para uma única linha quando connectionId é informado", async () => {
    const res = await GET(new Request("https://example.test/api/client/conversas?connectionId=conn-a"));
    const body = (await res.json()) as { conversations: { remoteJid: string }[] };

    expect(body.conversations.map((c) => c.remoteJid)).toEqual(["5511999990000@s.whatsapp.net"]);
  });

  it("retorna 401 sem sessão", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue(null);

    const res = await GET(new Request("https://example.test/api/client/conversas"));

    expect(res.status).toBe(401);
  });
});
