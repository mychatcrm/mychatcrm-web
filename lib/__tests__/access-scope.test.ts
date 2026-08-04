import { describe, expect, it } from "vitest";
import {
  leadInScope,
  loadLeadInScope,
  resolveAccessScope,
  scopeMatchesNothing,
  visibleLeadIds,
  type AccessScope,
  type ScopableLead,
} from "@/lib/server/access-scope";
import type { ClientSession } from "@/lib/client-auth";

function session(patch: Partial<ClientSession>): ClientSession {
  return {
    token: "t",
    tenantId: "tenant-a",
    email: "user@example.com",
    displayName: "User",
    companyName: "Tenant",
    plan: "equipa",
    planLabel: "Equipa",
    initials: "US",
    status: "ativa",
    ...patch,
  };
}

/**
 * Supabase falso que responde às cadeias usadas pelo resolvedor:
 *   from("team_members").select().eq().eq()
 *   from("leads").select().eq().eq()/.in()
 */
function fakeSupabase(options: {
  teamRows?: Array<{ team_id: string }>;
  teamError?: string;
  leadRows?: Array<{ id: string }>;
  leadRow?: ScopableLead | null;
  funnelAccessRows?: Array<{ funnel_id: string }>;
  funnelAccessError?: string;
  onLeadFilter?: (filter: { column: string; value: unknown }) => void;
}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const result =
        table === "team_members"
          ? { data: options.teamRows ?? [], error: options.teamError ? { message: options.teamError } : null }
          : table === "crm_funnel_access"
            ? {
                data: options.funnelAccessRows ?? [],
                error: options.funnelAccessError ? { message: options.funnelAccessError } : null,
              }
            : { data: options.leadRows ?? [], error: null };

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (table === "leads" && column !== "tenant_id") {
            options.onLeadFilter?.({ column, value });
          }
          return chain;
        },
        in: (column: string, value: unknown) => {
          if (table === "leads") options.onLeadFilter?.({ column, value });
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: options.leadRow ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      Object.assign(builder, chain);
      return chain;
    },
  } as never;
}

describe("resolveAccessScope", () => {
  it("dá escopo total ao titular da conta", async () => {
    const scope = await resolveAccessScope(fakeSupabase({}), session({ organizationRole: "owner" }));
    expect(scope).toEqual({ kind: "all" });
  });

  it("restringe o vendedor aos leads atribuídos a ele", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({}),
      session({ organizationRole: "seller", employeeId: "sel-1" }),
    );
    expect(scope).toEqual({ kind: "own", employeeId: "sel-1" });
  });

  it("dá ao diretor todas as equipes em que está", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamRows: [{ team_id: "t1" }, { team_id: "t2" }] }),
      session({ organizationRole: "director", employeeId: "dir-1" }),
    );
    expect(scope).toEqual({ kind: "teams", teamIds: ["t1", "t2"] });
  });

  it("dá ao gerente apenas a equipe dele", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamRows: [{ team_id: "t1" }] }),
      session({ organizationRole: "manager", employeeId: "man-1" }),
    );
    expect(scope).toEqual({ kind: "teams", teamIds: ["t1"] });
  });

  it("não devolve nada para diretor sem equipe nenhuma", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamRows: [] }),
      session({ organizationRole: "director", employeeId: "dir-9" }),
    );
    expect(scopeMatchesNothing(scope)).toBe(true);
  });

  it("falha fechado quando a consulta de equipes dá erro", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamError: "boom" }),
      session({ organizationRole: "manager", employeeId: "man-1" }),
    );
    expect(scopeMatchesNothing(scope)).toBe(true);
  });

  it("falha fechado para colaborador sem employeeId na sessão", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({}),
      session({ organizationRole: "director" }),
    );
    expect(scopeMatchesNothing(scope)).toBe(true);
  });

  it("remove equipes duplicadas", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamRows: [{ team_id: "t1" }, { team_id: "t1" }] }),
      session({ organizationRole: "director", employeeId: "dir-1" }),
    );
    expect(scope).toEqual({ kind: "teams", teamIds: ["t1"] });
  });
});

describe("leadInScope", () => {
  const teamScope: AccessScope = { kind: "teams", teamIds: ["t1", "t2"] };
  const sellerScope: AccessScope = { kind: "own", employeeId: "sel-1" };

  function lead(patch: Partial<ScopableLead>): ScopableLead {
    return { team_id: null, owner_employee_id: null, ...patch };
  }

  it("titular vê qualquer lead, inclusive sem equipe", () => {
    expect(leadInScope(lead({}), { kind: "all" })).toBe(true);
    expect(leadInScope(lead({ team_id: "t9" }), { kind: "all" })).toBe(true);
  });

  it("diretor/gerente veem leads das equipes deles", () => {
    expect(leadInScope(lead({ team_id: "t1" }), teamScope)).toBe(true);
    expect(leadInScope(lead({ team_id: "t2" }), teamScope)).toBe(true);
  });

  it("diretor/gerente não veem lead de outra equipe", () => {
    expect(leadInScope(lead({ team_id: "t3" }), teamScope)).toBe(false);
  });

  it("legado sem equipe não aparece para diretor/gerente", () => {
    expect(leadInScope(lead({ team_id: null }), teamScope)).toBe(false);
  });

  it("diretor/gerente veem lead da equipe mesmo sem vendedor definido", () => {
    expect(leadInScope(lead({ team_id: "t1", owner_employee_id: null }), teamScope)).toBe(true);
  });

  it("vendedor vê apenas o que está atribuído a ele", () => {
    expect(leadInScope(lead({ owner_employee_id: "sel-1", team_id: "t1" }), sellerScope)).toBe(true);
    expect(leadInScope(lead({ owner_employee_id: "sel-2", team_id: "t1" }), sellerScope)).toBe(false);
  });

  it("vendedor NÃO vê lead sem dono, mesmo sendo da equipe dele", () => {
    expect(leadInScope(lead({ owner_employee_id: null, team_id: "t1" }), sellerScope)).toBe(false);
  });

  it("escopo vazio não casa com nada", () => {
    const empty: AccessScope = { kind: "teams", teamIds: [] };
    expect(leadInScope(lead({ team_id: "t1" }), empty)).toBe(false);
  });
});

describe("loadLeadInScope", () => {
  it("libera o titular sem consultar o banco", async () => {
    let consultou = false;
    const sb = fakeSupabase({
      onLeadFilter: () => {
        consultou = true;
      },
    });
    expect(await loadLeadInScope(sb, "tenant-a", "lead-1", { kind: "all" })).not.toBeNull();
    expect(consultou).toBe(false);
  });

  it("nega sem consultar quando o escopo não casa com nada", async () => {
    let consultou = false;
    const sb = fakeSupabase({
      onLeadFilter: () => {
        consultou = true;
      },
    });
    const result = await loadLeadInScope(sb, "tenant-a", "lead-1", { kind: "teams", teamIds: [] });
    expect(result).toBeNull();
    expect(consultou).toBe(false);
  });

  it("nega lead de outra equipe", async () => {
    const sb = fakeSupabase({ leadRow: { id: "lead-1", team_id: "t9", owner_employee_id: null } });
    const result = await loadLeadInScope(sb, "tenant-a", "lead-1", { kind: "teams", teamIds: ["t1"] });
    expect(result).toBeNull();
  });

  it("aceita lead da própria equipe", async () => {
    const sb = fakeSupabase({ leadRow: { id: "lead-1", team_id: "t1", owner_employee_id: null } });
    const result = await loadLeadInScope(sb, "tenant-a", "lead-1", { kind: "teams", teamIds: ["t1"] });
    expect(result).not.toBeNull();
  });

  it("nega lead de outro vendedor", async () => {
    const sb = fakeSupabase({ leadRow: { id: "lead-1", team_id: "t1", owner_employee_id: "sel-2" } });
    const result = await loadLeadInScope(sb, "tenant-a", "lead-1", { kind: "own", employeeId: "sel-1" });
    expect(result).toBeNull();
  });

  it("devolve null quando o lead não existe", async () => {
    const sb = fakeSupabase({ leadRow: null });
    const result = await loadLeadInScope(sb, "tenant-a", "sumiu", { kind: "own", employeeId: "sel-1" });
    expect(result).toBeNull();
  });
});

describe("visibleLeadIds", () => {
  it("devolve null para o titular (sem recorte a aplicar)", async () => {
    expect(await visibleLeadIds(fakeSupabase({}), "tenant-a", { kind: "all" })).toBeNull();
  });

  it("devolve conjunto vazio sem consultar quando o escopo não casa com nada", async () => {
    let consultou = false;
    const sb = fakeSupabase({
      onLeadFilter: () => {
        consultou = true;
      },
    });
    const ids = await visibleLeadIds(sb, "tenant-a", { kind: "teams", teamIds: [] });
    expect(ids?.size).toBe(0);
    expect(consultou).toBe(false);
  });

  it("filtra por owner_employee_id no caso do vendedor", async () => {
    const filtros: Array<{ column: string; value: unknown }> = [];
    const sb = fakeSupabase({
      leadRows: [{ id: "lead-1" }],
      onLeadFilter: (f) => filtros.push(f),
    });
    const ids = await visibleLeadIds(sb, "tenant-a", { kind: "own", employeeId: "sel-1" });
    expect(ids).toEqual(new Set(["lead-1"]));
    expect(filtros).toContainEqual({ column: "owner_employee_id", value: "sel-1" });
  });

  it("filtra por team_id no caso de diretor/gerente", async () => {
    const filtros: Array<{ column: string; value: unknown }> = [];
    const sb = fakeSupabase({
      leadRows: [{ id: "lead-1" }, { id: "lead-2" }],
      onLeadFilter: (f) => filtros.push(f),
    });
    const ids = await visibleLeadIds(sb, "tenant-a", { kind: "teams", teamIds: ["t1", "t2"] });
    expect(ids).toEqual(new Set(["lead-1", "lead-2"]));
    expect(filtros).toContainEqual({ column: "team_id", value: ["t1", "t2"] });
  });
});

describe("liberação de funil por colaborador", () => {
  it("não restringe quando o titular não liberou nenhum funil", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ funnelAccessRows: [] }),
      session({ organizationRole: "seller", employeeId: "sel-1" }),
    );
    expect(scope).toEqual({ kind: "own", employeeId: "sel-1" });
    expect((scope as { funnelIds?: string[] }).funnelIds).toBeUndefined();
  });

  it("carrega os funis liberados para o vendedor", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ funnelAccessRows: [{ funnel_id: "funil-a" }, { funnel_id: "funil-b" }] }),
      session({ organizationRole: "seller", employeeId: "sel-1" }),
    );
    expect(scope).toEqual({ kind: "own", employeeId: "sel-1", funnelIds: ["funil-a", "funil-b"] });
  });

  it("aplica a liberação também a diretor e gerente", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ teamRows: [{ team_id: "t1" }], funnelAccessRows: [{ funnel_id: "funil-a" }] }),
      session({ organizationRole: "manager", employeeId: "man-1" }),
    );
    expect(scope).toEqual({ kind: "teams", teamIds: ["t1"], funnelIds: ["funil-a"] });
  });

  it("mantém o recorte por dono quando a leitura da liberação falha", async () => {
    const scope = await resolveAccessScope(
      fakeSupabase({ funnelAccessError: "boom" }),
      session({ organizationRole: "seller", employeeId: "sel-1" }),
    );
    // Falha de leitura não pode virar liberação geral nem bloqueio total.
    expect(scope).toEqual({ kind: "own", employeeId: "sel-1" });
  });

  it("esconde o lead que está fora dos funis liberados", () => {
    const scope: AccessScope = { kind: "own", employeeId: "sel-1", funnelIds: ["funil-a"] };
    const meuLeadNoFunilLiberado: ScopableLead = {
      owner_employee_id: "sel-1",
      crm_funnel_id: "funil-a",
    };
    const meuLeadEmOutroFunil: ScopableLead = {
      owner_employee_id: "sel-1",
      crm_funnel_id: "funil-z",
    };

    expect(leadInScope(meuLeadNoFunilLiberado, scope)).toBe(true);
    expect(leadInScope(meuLeadEmOutroFunil, scope)).toBe(false);
  });

  it("nunca amplia: lead de colega no funil liberado continua invisível", () => {
    const scope: AccessScope = { kind: "own", employeeId: "sel-1", funnelIds: ["funil-a"] };
    const leadDoColega: ScopableLead = {
      owner_employee_id: "sel-2",
      crm_funnel_id: "funil-a",
    };
    expect(leadInScope(leadDoColega, scope)).toBe(false);
  });

  it("lead sem funil definido não entra numa liberação explícita", () => {
    const scope: AccessScope = { kind: "own", employeeId: "sel-1", funnelIds: ["funil-a"] };
    expect(leadInScope({ owner_employee_id: "sel-1", crm_funnel_id: null }, scope)).toBe(false);
    // Sem liberação, o mesmo lead aparece normalmente.
    expect(leadInScope({ owner_employee_id: "sel-1", crm_funnel_id: null }, { kind: "own", employeeId: "sel-1" })).toBe(true);
  });

  it("o titular nunca é restringido por funil", () => {
    expect(leadInScope({ crm_funnel_id: "funil-z" }, { kind: "all" })).toBe(true);
  });

  it("filtra por crm_funnel_id na própria query de visibleLeadIds", async () => {
    const filtros: Array<{ column: string; value: unknown }> = [];
    const sb = fakeSupabase({
      leadRows: [{ id: "lead-1" }],
      onLeadFilter: (f) => filtros.push(f),
    });

    await visibleLeadIds(sb, "tenant-a", {
      kind: "own",
      employeeId: "sel-1",
      funnelIds: ["funil-a"],
    });

    expect(filtros).toContainEqual({ column: "crm_funnel_id", value: ["funil-a"] });
    expect(filtros).toContainEqual({ column: "owner_employee_id", value: "sel-1" });
  });
});
