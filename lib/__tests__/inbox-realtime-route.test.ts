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

import { GET, POST } from "@/app/api/client/conversas/realtime/route";

const OWN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const rows = [
  {
    id: OWN_ID,
    tenant_id: "tenant-own",
    remote_jid: "own@s.whatsapp.net",
    direction: "inbound",
    kind: "text",
    content: "own",
    created_at: "2026-07-22T20:00:00.000Z",
  },
  {
    id: OTHER_ID,
    tenant_id: "tenant-other",
    remote_jid: "other@s.whatsapp.net",
    direction: "inbound",
    kind: "text",
    content: "other",
    created_at: "2026-07-22T20:00:00.000Z",
  },
];

function makeMessagesQuery() {
  let result = rows;
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      result = result.filter((row) => row[column as keyof typeof row] === value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      result = result.filter((row) => values.includes(row[column as keyof typeof row]));
      return Promise.resolve({ data: result, error: null });
    },
  };
  return builder;
}

function post(ids: unknown) {
  return POST(
    new Request("https://example.test/api/client/conversas/realtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  );
}

describe("/api/client/conversas/realtime", () => {
  beforeEach(() => {
    getClientSessionFromCookiesMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    getClientSessionFromCookiesMock.mockResolvedValue({ tenantId: "tenant-own" });
    createSupabaseServiceClientMock.mockReturnValue({
      rpc: vi.fn(async (_name: string, params: { p_tenant_id: string }) => ({
        data: `inbox:opaque-${params.p_tenant_id}`,
        error: null,
      })),
      from: vi.fn(() => makeMessagesQuery()),
    });
  });

  it("returns only the capability topic for the authenticated tenant", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ topic: "inbox:opaque-tenant-own" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("never hydrates a message belonging to another tenant", async () => {
    const response = await post([OWN_ID, OTHER_ID]);
    const body = (await response.json()) as { messages: Array<{ id: string; content: string }> };

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([expect.objectContaining({ id: OWN_ID, content: "own" })]);
    expect(JSON.stringify(body)).not.toContain("other");
  });

  it("rejects both topic and hydration without a client session", async () => {
    getClientSessionFromCookiesMock.mockResolvedValue(null);

    const [topicResponse, hydrateResponse] = await Promise.all([GET(), post([OWN_ID])]);

    expect(topicResponse.status).toBe(401);
    expect(hydrateResponse.status).toBe(401);
  });

  it("ignores invalid IDs before querying", async () => {
    const response = await post(["not-a-uuid"]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });
});

/**
 * O tópico de broadcast é por conta, então o navegador de um vendedor recebe o
 * id de QUALQUER mensagem do tenant. Esta rota devolve o conteúdo, então sem
 * recorte ela entregaria a conversa do colega em tempo real.
 */
describe("/api/client/conversas/realtime — recorte por vendedor", () => {
  const MINE = "33333333-3333-4333-8333-333333333333";
  const COLLEAGUE = "44444444-4444-4444-8444-444444444444";

  const tenantRows = [
    {
      id: MINE,
      tenant_id: "tenant-own",
      remote_jid: "5511999990001@s.whatsapp.net",
      direction: "inbound",
      kind: "text",
      content: "mensagem do meu lead",
      created_at: "2026-07-31T10:00:00.000Z",
    },
    {
      id: COLLEAGUE,
      tenant_id: "tenant-own",
      remote_jid: "5511999990002@s.whatsapp.net",
      direction: "inbound",
      kind: "text",
      content: "SEGREDO do lead do colega",
      created_at: "2026-07-31T10:00:00.000Z",
    },
  ];

  beforeEach(() => {
    getClientSessionFromCookiesMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    getClientSessionFromCookiesMock.mockResolvedValue({
      tenantId: "tenant-own",
      organizationRole: "seller",
      employeeId: "sel-1",
    });

    createSupabaseServiceClientMock.mockReturnValue({
      rpc: vi.fn(async () => ({ data: "inbox:opaque", error: null })),
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {};
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          in: (column: string, values: unknown[]) => {
            filters[`in:${column}`] = values;
            if (table === "whatsapp_messages") {
              return Promise.resolve({
                data: tenantRows.filter((row) => values.includes(row.id)),
                error: null,
              });
            }
            return chain;
          },
          then: (resolve: (v: unknown) => unknown) => {
            if (table === "leads") {
              // Só o lead do vendedor logado.
              const owned = [{ id: "lead-mine", phone: "5511999990001" }];
              return Promise.resolve({ data: owned, error: null }).then(resolve);
            }
            if (table === "conversation_states") {
              return Promise.resolve({
                data: [
                  { remote_jid: "5511999990001@s.whatsapp.net", lead_id: "lead-mine" },
                  { remote_jid: "5511999990002@s.whatsapp.net", lead_id: "lead-colega" },
                ],
                error: null,
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return chain;
      }),
    });
  });

  it("não devolve o conteúdo da conversa de um colega", async () => {
    const response = await post([MINE, COLLEAGUE]);
    const body = (await response.json()) as { messages: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.messages.map((m) => m.id)).toEqual([MINE]);
    expect(JSON.stringify(body)).not.toContain("SEGREDO");
  });
});
