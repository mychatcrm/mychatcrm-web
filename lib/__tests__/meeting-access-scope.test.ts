/**
 * Matriz de isolamento das reunioes.
 *
 * Um furo aqui significa colaborador de uma empresa lendo a reuniao de outra,
 * ou vendedor ouvindo a conversa de um colega. E o teste mais caro do modulo:
 * cobre os 4 papeis contra as 4 visibilidades, com e sem lead, dentro e fora
 * da equipe.
 */
import { describe, expect, it } from "vitest";
import {
  buildMeetingVisibilityFilter,
  hasMeetingAccessGrant,
  loadMeetingInScope,
  meetingInScope,
} from "@/lib/server/meeting-access-scope";
import type { AccessScope, ScopableLead } from "@/lib/server/access-scope";
import type { MeetingVisibility, ScopableMeeting } from "@/lib/meetings/types";

// ── Ajudantes ───────────────────────────────────────────────────────────────

const OWNER_SCOPE: AccessScope = { kind: "all" };
const DIRECTOR_SCOPE: AccessScope = { kind: "teams", teamIds: ["team-1", "team-2"] };
const MANAGER_SCOPE: AccessScope = { kind: "teams", teamIds: ["team-1"] };
const SELLER_SCOPE: AccessScope = { kind: "own", employeeId: "emp-seller" };
/** Diretor recem-criado, ainda sem equipe: escopo que nao casa com nada. */
const EMPTY_SCOPE: AccessScope = { kind: "teams", teamIds: [] };

function meeting(patch: Partial<ScopableMeeting> = {}): ScopableMeeting {
  return {
    created_by_employee_id: "emp-author",
    team_id: "team-1",
    lead_id: null,
    visibility: "private",
    ...patch,
  };
}

function lead(patch: Partial<ScopableLead> = {}): ScopableLead {
  return { team_id: "team-1", owner_employee_id: "emp-seller", crm_funnel_id: "funnel-1", ...patch };
}

/**
 * Supabase falso cobrindo as cadeias usadas pelo modulo:
 *   from("meetings").select().eq().eq().is().maybeSingle()
 *   from("leads").select().eq().eq().maybeSingle()      (visibilidade por lead)
 *   from("leads").select().eq().eq()/.in()              (visibleLeadIds)
 *   from("meeting_access_grants")...maybeSingle()
 */
function fakeSupabase(options: {
  meetingRow?: Record<string, unknown> | null;
  leadRow?: ScopableLead | null;
  leadIdRows?: Array<{ id: string }>;
  grantRow?: Record<string, unknown> | null;
  onMeetingFilter?: (filter: { column: string; value: unknown }) => void;
}) {
  return {
    from(table: string) {
      const listResult = { data: options.leadIdRows ?? [], error: null };

      const singleFor = () => {
        if (table === "meetings") return options.meetingRow ?? null;
        if (table === "leads") return options.leadRow ?? null;
        if (table === "meeting_access_grants") return options.grantRow ?? null;
        return null;
      };

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (table === "meetings") options.onMeetingFilter?.({ column, value });
          return chain;
        },
        in: () => chain,
        is: () => chain,
        maybeSingle: () => Promise.resolve({ data: singleFor(), error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(listResult).then(resolve),
      };
      return chain;
    },
  } as never;
}

const ALL_VISIBILITIES: MeetingVisibility[] = ["private", "team", "company", "lead"];

// ── Titular ─────────────────────────────────────────────────────────────────

describe("titular da conta", () => {
  it("alcanca qualquer reuniao, em qualquer visibilidade", () => {
    for (const visibility of ALL_VISIBILITIES) {
      expect(
        meetingInScope(meeting({ visibility, team_id: "team-outra" }), OWNER_SCOPE, {}),
      ).toBe(true);
    }
  });
});

// ── Autor ───────────────────────────────────────────────────────────────────

describe("autor da reuniao", () => {
  it("alcanca a propria reuniao mesmo sendo privada e fora da equipe dele", () => {
    const own = meeting({ created_by_employee_id: "emp-seller", visibility: "private", team_id: "team-9" });
    expect(meetingInScope(own, SELLER_SCOPE, { employeeId: "emp-seller" })).toBe(true);
  });

  it("continua alcancando quando o escopo nao casa com nada (diretor sem equipe)", () => {
    const own = meeting({ created_by_employee_id: "emp-dir", visibility: "private" });
    expect(meetingInScope(own, EMPTY_SCOPE, { employeeId: "emp-dir" })).toBe(true);
  });

  it("nao confunde reuniao do titular (autor nulo) com sessao sem colaborador", () => {
    // Reuniao gravada pelo titular grava `created_by_employee_id = null`; uma
    // sessao sem `employeeId` nao pode herdar autoria por comparacao frouxa.
    const byOwner = meeting({ created_by_employee_id: null, visibility: "private" });
    expect(meetingInScope(byOwner, EMPTY_SCOPE, {})).toBe(false);
    expect(meetingInScope(byOwner, EMPTY_SCOPE, { employeeId: "   " })).toBe(false);
  });
});

// ── Matriz papel × visibilidade ─────────────────────────────────────────────

describe("matriz de papel contra visibilidade (reuniao de terceiro)", () => {
  const cases: Array<{
    papel: string;
    scope: AccessScope;
    employeeId?: string;
    esperado: Record<MeetingVisibility, boolean>;
  }> = [
    {
      papel: "diretor (equipe da reuniao no escopo)",
      scope: DIRECTOR_SCOPE,
      employeeId: "emp-dir",
      esperado: { private: false, team: true, company: true, lead: true },
    },
    {
      papel: "gerente (equipe da reuniao no escopo)",
      scope: MANAGER_SCOPE,
      employeeId: "emp-mgr",
      esperado: { private: false, team: true, company: true, lead: true },
    },
    {
      papel: "vendedor",
      scope: SELLER_SCOPE,
      employeeId: "emp-seller",
      // Vendedor nao herda reuniao de equipe: o recorte dele e por atribuicao,
      // igual ao que ja vale para lead e conversa.
      esperado: { private: false, team: false, company: true, lead: true },
    },
  ];

  for (const caso of cases) {
    for (const visibility of ALL_VISIBILITIES) {
      it(`${caso.papel} · visibilidade "${visibility}" → ${caso.esperado[visibility]}`, () => {
        const row = meeting({
          created_by_employee_id: "emp-outro",
          visibility,
          team_id: "team-1",
          lead_id: visibility === "lead" ? "lead-1" : null,
        });
        const leadRow = visibility === "lead" ? lead() : null;
        expect(meetingInScope(row, caso.scope, { employeeId: caso.employeeId }, leadRow)).toBe(
          caso.esperado[visibility],
        );
      });
    }
  }
});

// ── Visibilidade por equipe ─────────────────────────────────────────────────

describe('visibilidade "team"', () => {
  it("nega quando a equipe da reuniao esta fora do escopo", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "team", team_id: "team-9" });
    expect(meetingInScope(row, MANAGER_SCOPE, { employeeId: "emp-mgr" })).toBe(false);
  });

  it("nega quando a reuniao nao tem equipe carimbada (legado)", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "team", team_id: null });
    expect(meetingInScope(row, DIRECTOR_SCOPE, { employeeId: "emp-dir" })).toBe(false);
  });
});

// ── Visibilidade por lead ───────────────────────────────────────────────────

describe('visibilidade "lead"', () => {
  it("segue a regra do lead: vendedor so alcanca lead atribuido a ele", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "lead", lead_id: "lead-1" });
    expect(
      meetingInScope(row, SELLER_SCOPE, { employeeId: "emp-seller" }, lead({ owner_employee_id: "emp-outro" })),
    ).toBe(false);
    expect(
      meetingInScope(row, SELLER_SCOPE, { employeeId: "emp-seller" }, lead({ owner_employee_id: "emp-seller" })),
    ).toBe(true);
  });

  it("respeita a liberacao por funil sem duplicar a regra", () => {
    const scope: AccessScope = { kind: "own", employeeId: "emp-seller", funnelIds: ["funnel-2"] };
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "lead", lead_id: "lead-1" });
    expect(meetingInScope(row, scope, { employeeId: "emp-seller" }, lead({ crm_funnel_id: "funnel-1" }))).toBe(false);
    expect(meetingInScope(row, scope, { employeeId: "emp-seller" }, lead({ crm_funnel_id: "funnel-2" }))).toBe(true);
  });

  it("falha fechado quando a linha do lead nao chega", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "lead", lead_id: "lead-1" });
    expect(meetingInScope(row, DIRECTOR_SCOPE, { employeeId: "emp-dir" }, null)).toBe(false);
    expect(meetingInScope(row, DIRECTOR_SCOPE, { employeeId: "emp-dir" })).toBe(false);
  });

  it("falha fechado quando a visibilidade e de lead mas nao ha lead vinculado", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: "lead", lead_id: null });
    expect(meetingInScope(row, DIRECTOR_SCOPE, { employeeId: "emp-dir" }, lead())).toBe(false);
  });
});

// ── Visibilidade ausente ────────────────────────────────────────────────────

describe("visibilidade ausente ou desconhecida", () => {
  it("trata ausencia como privada (fail-closed)", () => {
    const row = meeting({ created_by_employee_id: "emp-outro", visibility: null });
    expect(meetingInScope(row, DIRECTOR_SCOPE, { employeeId: "emp-dir" })).toBe(false);
    expect(meetingInScope(row, OWNER_SCOPE, {})).toBe(true);
  });
});

// ── loadMeetingInScope ──────────────────────────────────────────────────────

describe("loadMeetingInScope", () => {
  it("sempre filtra por tenant e por id — reuniao de outra empresa nunca e lida", async () => {
    const filters: Array<{ column: string; value: unknown }> = [];
    const sb = fakeSupabase({
      meetingRow: { id: "m-1", ...meeting({ visibility: "company" }) },
      onMeetingFilter: (f) => filters.push(f),
    });

    await loadMeetingInScope(sb, "tenant-a", "m-1", DIRECTOR_SCOPE, { employeeId: "emp-dir" });

    expect(filters).toContainEqual({ column: "tenant_id", value: "tenant-a" });
    expect(filters).toContainEqual({ column: "id", value: "m-1" });
  });

  it("devolve null quando a reuniao nao existe", async () => {
    const sb = fakeSupabase({ meetingRow: null });
    const found = await loadMeetingInScope(sb, "tenant-a", "m-1", OWNER_SCOPE, {});
    expect(found).toBeNull();
  });

  it("devolve null — e nao 403 — para reuniao existente fora do escopo", async () => {
    const sb = fakeSupabase({
      meetingRow: { id: "m-1", ...meeting({ created_by_employee_id: "emp-outro", visibility: "private" }) },
      grantRow: null,
    });
    const found = await loadMeetingInScope(sb, "tenant-a", "m-1", SELLER_SCOPE, { employeeId: "emp-seller" });
    expect(found).toBeNull();
  });

  it("carrega o lead para decidir visibilidade por lead", async () => {
    const sb = fakeSupabase({
      meetingRow: { id: "m-1", ...meeting({ created_by_employee_id: "emp-outro", visibility: "lead", lead_id: "lead-1" }) },
      leadRow: lead({ owner_employee_id: "emp-seller" }),
    });
    const found = await loadMeetingInScope(sb, "tenant-a", "m-1", SELLER_SCOPE, { employeeId: "emp-seller" });
    expect(found).not.toBeNull();
  });

  it("libera por compartilhamento pontual quando o escopo normal nega", async () => {
    const sb = fakeSupabase({
      meetingRow: { id: "m-1", ...meeting({ created_by_employee_id: "emp-outro", visibility: "private" }) },
      grantRow: { meeting_id: "m-1" },
    });
    const found = await loadMeetingInScope(sb, "tenant-a", "m-1", SELLER_SCOPE, { employeeId: "emp-seller" });
    expect(found).not.toBeNull();
  });
});

describe("hasMeetingAccessGrant", () => {
  it("nega sessao sem colaborador vinculado", async () => {
    const sb = fakeSupabase({ grantRow: { meeting_id: "m-1" } });
    expect(await hasMeetingAccessGrant(sb, "tenant-a", "m-1", {})).toBe(false);
  });
});

// ── Filtro de listagem ──────────────────────────────────────────────────────

describe("buildMeetingVisibilityFilter", () => {
  it("nao recorta para o titular", async () => {
    const sb = fakeSupabase({});
    expect(await buildMeetingVisibilityFilter(sb, "tenant-a", OWNER_SCOPE, {})).toEqual({ kind: "all" });
  });

  it("monta autor, empresa, equipe e lead para diretor", async () => {
    const sb = fakeSupabase({ leadIdRows: [{ id: "lead-1" }, { id: "lead-2" }] });
    const filter = await buildMeetingVisibilityFilter(sb, "tenant-a", DIRECTOR_SCOPE, { employeeId: "emp-dir" });

    expect(filter.kind).toBe("or");
    const expression = filter.kind === "or" ? filter.expression : "";
    expect(expression).toContain("visibility.eq.company");
    expect(expression).toContain("created_by_employee_id.eq.emp-dir");
    expect(expression).toContain("and(visibility.eq.team,team_id.in.(team-1,team-2))");
    expect(expression).toContain("and(visibility.eq.lead,lead_id.in.(lead-1,lead-2))");
  });

  it("nao inclui condicao de equipe para vendedor", async () => {
    const sb = fakeSupabase({ leadIdRows: [{ id: "lead-1" }] });
    const filter = await buildMeetingVisibilityFilter(sb, "tenant-a", SELLER_SCOPE, { employeeId: "emp-seller" });
    const expression = filter.kind === "or" ? filter.expression : "";
    expect(expression).not.toContain("visibility.eq.team");
    expect(expression).toContain("created_by_employee_id.eq.emp-seller");
  });

  it("descarta identificadores que nao sao seguros para interpolar", async () => {
    const sb = fakeSupabase({ leadIdRows: [{ id: "lead-1" }] });
    const hostile: AccessScope = { kind: "teams", teamIds: ["team-1", "a,b)", "x'y"] };
    const filter = await buildMeetingVisibilityFilter(sb, "tenant-a", hostile, { employeeId: "emp-dir" });
    const expression = filter.kind === "or" ? filter.expression : "";
    expect(expression).toContain("team_id.in.(team-1)");
    expect(expression).not.toContain("a,b)");
    expect(expression).not.toContain("x'y");
  });

  it("omite a condicao de lead quando nao ha lead visivel", async () => {
    const sb = fakeSupabase({ leadIdRows: [] });
    const filter = await buildMeetingVisibilityFilter(sb, "tenant-a", EMPTY_SCOPE, { employeeId: "emp-dir" });
    const expression = filter.kind === "or" ? filter.expression : "";
    expect(expression).not.toContain("visibility.eq.lead");
    // Sem equipe e sem lead, ainda restam empresa e autoria.
    expect(expression).toContain("visibility.eq.company");
    expect(expression).toContain("created_by_employee_id.eq.emp-dir");
  });
});
