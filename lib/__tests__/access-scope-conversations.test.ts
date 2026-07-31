import { describe, expect, it } from "vitest";
import {
  conversationInScope,
  filterConversationsInScope,
  type AccessScope,
} from "@/lib/server/access-scope";

/**
 * Supabase falso que atende as cadeias usadas pelo recorte de conversas:
 *   conversation_states.select().eq().eq().maybeSingle()  → estado da conversa
 *   conversation_states.select().eq().in()                → estados em lote
 *   leads.select().eq().eq().maybeSingle()                → lead por id/telefone
 *   leads.select().eq().eq()/.in()                        → leads do escopo
 */
function fakeSupabase(db: {
  states?: Array<{ remote_jid: string; lead_id: string | null }>;
  leads?: Array<{ id: string; phone?: string; team_id?: string | null; owner_employee_id?: string | null }>;
}) {
  const states = db.states ?? [];
  const leads = db.leads ?? [];

  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        in: (col: string, val: unknown) => {
          filters[`in:${col}`] = val;
          return chain;
        },
        maybeSingle: () => {
          if (table === "conversation_states") {
            const row = states.find((s) => s.remote_jid === filters.remote_jid) ?? null;
            return Promise.resolve({ data: row, error: null });
          }
          const row =
            leads.find((l) =>
              filters.id ? l.id === filters.id : filters.phone ? l.phone === filters.phone : false,
            ) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "conversation_states") {
            const wanted = (filters["in:remote_jid"] as string[]) ?? [];
            return Promise.resolve({
              data: states.filter((s) => wanted.includes(s.remote_jid)),
              error: null,
            }).then(resolve);
          }
          let rows = leads;
          if (filters.owner_employee_id) {
            rows = rows.filter((l) => l.owner_employee_id === filters.owner_employee_id);
          }
          if (filters["in:team_id"]) {
            const teams = filters["in:team_id"] as string[];
            rows = rows.filter((l) => l.team_id && teams.includes(l.team_id));
          }
          if (filters["in:phone"]) {
            const phones = filters["in:phone"] as string[];
            rows = rows.filter((l) => l.phone && phones.includes(l.phone));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return chain;
    },
  } as never;
}

const JID_A = "5511999990001@s.whatsapp.net";
const JID_B = "5511999990002@s.whatsapp.net";

const sellerScope: AccessScope = { kind: "own", employeeId: "sel-1" };
const teamScope: AccessScope = { kind: "teams", teamIds: ["t1"] };

describe("conversationInScope", () => {
  const db = {
    states: [
      { remote_jid: JID_A, lead_id: "lead-a" },
      { remote_jid: JID_B, lead_id: "lead-b" },
    ],
    leads: [
      { id: "lead-a", phone: "5511999990001", team_id: "t1", owner_employee_id: "sel-1" },
      { id: "lead-b", phone: "5511999990002", team_id: "t2", owner_employee_id: "sel-2" },
    ],
  };

  it("titular alcança qualquer conversa", async () => {
    expect(await conversationInScope(fakeSupabase(db), "tenant-a", JID_B, { kind: "all" })).toBe(true);
  });

  it("vendedor alcança a conversa do lead dele", async () => {
    expect(await conversationInScope(fakeSupabase(db), "tenant-a", JID_A, sellerScope)).toBe(true);
  });

  it("vendedor NÃO alcança a conversa de um colega", async () => {
    expect(await conversationInScope(fakeSupabase(db), "tenant-a", JID_B, sellerScope)).toBe(false);
  });

  it("gerente alcança conversa da equipe dele e recusa a de outra", async () => {
    const sb = fakeSupabase(db);
    expect(await conversationInScope(sb, "tenant-a", JID_A, teamScope)).toBe(true);
    expect(await conversationInScope(fakeSupabase(db), "tenant-a", JID_B, teamScope)).toBe(false);
  });

  it("resolve pelo telefone quando a conversa não tem lead_id", async () => {
    const sb = fakeSupabase({
      states: [{ remote_jid: JID_A, lead_id: null }],
      leads: [{ id: "lead-a", phone: "5511999990001", team_id: "t1", owner_employee_id: "sel-1" }],
    });
    expect(await conversationInScope(sb, "tenant-a", JID_A, sellerScope)).toBe(true);
  });

  it("recusa conversa sem lead nenhum (nem por telefone)", async () => {
    const sb = fakeSupabase({ states: [{ remote_jid: JID_A, lead_id: null }], leads: [] });
    expect(await conversationInScope(sb, "tenant-a", JID_A, sellerScope)).toBe(false);
  });

  it("escopo vazio não alcança nada", async () => {
    const sb = fakeSupabase(db);
    expect(await conversationInScope(sb, "tenant-a", JID_A, { kind: "teams", teamIds: [] })).toBe(false);
  });
});

describe("filterConversationsInScope", () => {
  const db = {
    states: [
      { remote_jid: JID_A, lead_id: "lead-a" },
      { remote_jid: JID_B, lead_id: "lead-b" },
    ],
    leads: [
      { id: "lead-a", phone: "5511999990001", team_id: "t1", owner_employee_id: "sel-1" },
      { id: "lead-b", phone: "5511999990002", team_id: "t2", owner_employee_id: "sel-2" },
    ],
  };

  it("devolve tudo para o titular", async () => {
    const out = await filterConversationsInScope(fakeSupabase(db), "tenant-a", [JID_A, JID_B], {
      kind: "all",
    });
    expect(out).toEqual([JID_A, JID_B]);
  });

  it("mantém só as conversas do vendedor", async () => {
    const out = await filterConversationsInScope(fakeSupabase(db), "tenant-a", [JID_A, JID_B], sellerScope);
    expect(out).toEqual([JID_A]);
  });

  it("devolve vazio quando o escopo não casa com nada", async () => {
    const out = await filterConversationsInScope(fakeSupabase(db), "tenant-a", [JID_A], {
      kind: "teams",
      teamIds: [],
    });
    expect(out).toEqual([]);
  });

  it("lida com lista vazia", async () => {
    expect(await filterConversationsInScope(fakeSupabase(db), "tenant-a", [], sellerScope)).toEqual([]);
  });
});
