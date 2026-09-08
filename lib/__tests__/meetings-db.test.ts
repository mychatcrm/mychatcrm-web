/**
 * Fronteiras de seguranca do CRUD de reunioes:
 * - vincular a um lead que a pessoa nao alcanca (seria descobrir que ele existe
 *   e, pior, compartilhar a gravacao com quem cuida dele);
 * - a chave do storage sempre sob o prefixo do proprio tenant;
 * - o recorte de listagem indo para a query, nao para a memoria.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildMeetingStorageKey,
  createMeeting,
  defaultVisibilityForSession,
  listMeetingsForSession,
  updateMeetingForSession,
} from "@/lib/server/meetings-db";
import type { AccessScope, ScopableLead } from "@/lib/server/access-scope";
import type { ClientSession } from "@/lib/client-auth";

const OWNER_SCOPE: AccessScope = { kind: "all" };
const SELLER_SCOPE: AccessScope = { kind: "own", employeeId: "emp-seller" };

function session(patch: Partial<ClientSession> = {}): ClientSession {
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

type FakeOptions = {
  leadRow?: ScopableLead | null;
  teamRows?: Array<{ team_id: string }>;
  meetingRow?: Record<string, unknown> | null;
  meetingList?: Array<Record<string, unknown>>;
  rpcResult?: Record<string, unknown>;
};

function fakeSupabase(options: FakeOptions = {}) {
  const calls = {
    rpc: [] as Array<{ name: string; params: Record<string, unknown> }>,
    or: [] as string[],
    updates: [] as Array<Record<string, unknown>>,
  };

  const CHAINABLE = [
    "select", "eq", "in", "is", "or", "gte", "lte", "ilike", "order", "range", "insert",
  ] as const;

  function chain(table: string) {
    const c: Record<string, unknown> = {};
    for (const method of CHAINABLE) {
      c[method] = (...args: unknown[]) => {
        if (method === "or" && typeof args[0] === "string") calls.or.push(args[0]);
        return c;
      };
    }
    c.update = (patch: Record<string, unknown>) => {
      calls.updates.push(patch);
      return c;
    };
    c.maybeSingle = () =>
      Promise.resolve({
        data:
          table === "leads"
            ? (options.leadRow ?? null)
            : table === "meetings"
              ? (options.meetingRow ?? null)
              : null,
        error: null,
      });
    c.single = c.maybeSingle;
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === "team_members"
            ? (options.teamRows ?? [])
            : table === "meetings"
              ? (options.meetingList ?? [])
              : [],
        error: null,
      }).then(resolve);
    return c;
  }

  const sb = {
    from: (table: string) => chain(table),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.rpc.push({ name, params });
      // Devolve uma linha coerente com o que foi reservado.
      return Promise.resolve({
        data: options.rpcResult ?? {
          id: String(params.p_meeting_id ?? "m-1"),
          tenant_id: params.p_tenant_id,
          created_by_employee_id: params.p_created_by_employee_id,
          team_id: params.p_team_id,
          lead_id: params.p_lead_id,
          title: params.p_title,
          meeting_type: params.p_meeting_type,
          language: params.p_language,
          source: params.p_source,
          tags: [],
          visibility: params.p_visibility,
          status: "draft",
          storage_bucket: "",
          storage_key: params.p_storage_key,
          size_bytes: 0,
          mime_type: params.p_mime_type,
          processing_version: 1,
          user_notes: "",
          created_at: "2026-09-08T00:00:00.000Z",
          updated_at: "2026-09-08T00:00:00.000Z",
        },
        error: null,
      });
    },
  };

  return { sb: sb as never, calls };
}

// ── Chave do storage ────────────────────────────────────────────────────────

describe("buildMeetingStorageKey", () => {
  it("sempre grava sob o prefixo do proprio tenant", () => {
    const key = buildMeetingStorageKey({
      tenantId: "tenant-a",
      meetingId: "m-1",
      mimeType: "audio/webm;codecs=opus",
    });
    expect(key).toBe("meetings/tenant-a/m-1/audio.webm");
  });

  it("deriva a extensao do mime type, nao de nome de arquivo", () => {
    expect(
      buildMeetingStorageKey({ tenantId: "t", meetingId: "m", mimeType: "audio/mp4" }),
    ).toMatch(/audio\.m4a$/);
  });

  it("recusa mime type nao suportado em vez de inventar extensao", () => {
    expect(() =>
      buildMeetingStorageKey({ tenantId: "t", meetingId: "m", mimeType: "application/pdf" }),
    ).toThrow("meeting_mime_type_not_supported");
  });
});

// ── Visibilidade padrao ─────────────────────────────────────────────────────

describe("defaultVisibilityForSession", () => {
  it("lead vinculado manda sobre o papel", () => {
    expect(defaultVisibilityForSession(session({ organizationRole: "seller", employeeId: "e" }), true)).toBe("lead");
  });

  it("sem lead, segue o papel", () => {
    expect(defaultVisibilityForSession(session(), false)).toBe("company");
    expect(defaultVisibilityForSession(session({ organizationRole: "director", employeeId: "e" }), false)).toBe("team");
    expect(defaultVisibilityForSession(session({ organizationRole: "manager", employeeId: "e" }), false)).toBe("team");
    expect(defaultVisibilityForSession(session({ organizationRole: "seller", employeeId: "e" }), false)).toBe("private");
  });
});

// ── createMeeting ───────────────────────────────────────────────────────────

describe("createMeeting", () => {
  it("recusa lead fora do escopo de quem esta gravando", async () => {
    const { sb } = fakeSupabase({ leadRow: { team_id: "team-9", owner_employee_id: "emp-outro" } });
    await expect(
      createMeeting({
        sb,
        session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
        scope: SELLER_SCOPE,
        source: "record",
        mimeType: "audio/webm",
        leadId: "lead-de-outro",
      }),
    ).rejects.toThrow("meeting_lead_not_found");
  });

  it("recusa lead inexistente com o mesmo erro — nao revela se existe", async () => {
    const { sb } = fakeSupabase({ leadRow: null });
    await expect(
      createMeeting({
        sb,
        session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
        scope: SELLER_SCOPE,
        source: "record",
        mimeType: "audio/webm",
        leadId: "lead-inexistente",
      }),
    ).rejects.toThrow("meeting_lead_not_found");
  });

  it("aceita lead do proprio vendedor e herda a equipe do lead", async () => {
    const { sb, calls } = fakeSupabase({
      leadRow: { team_id: "team-1", owner_employee_id: "emp-seller" },
    });
    const created = await createMeeting({
      sb,
      session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
      scope: SELLER_SCOPE,
      source: "record",
      mimeType: "audio/webm",
      leadId: "lead-1",
    });

    expect(created.leadId).toBe("lead-1");
    expect(created.teamId).toBe("team-1");
    expect(created.visibility).toBe("lead");
    expect(calls.rpc[0]?.name).toBe("reserve_meeting_v1");
  });

  it("carimba a chave sob o tenant da sessao", async () => {
    const { sb, calls } = fakeSupabase({});
    await createMeeting({
      sb,
      session: session(),
      scope: OWNER_SCOPE,
      source: "upload",
      mimeType: "audio/mpeg",
    });
    expect(calls.rpc[0]?.params.p_storage_key).toMatch(/^meetings\/tenant-a\//);
  });

  it("recusa mime type nao suportado antes de tocar o banco", async () => {
    const { sb, calls } = fakeSupabase({});
    await expect(
      createMeeting({ sb, session: session(), scope: OWNER_SCOPE, source: "upload", mimeType: "image/png" }),
    ).rejects.toThrow("meeting_mime_type_not_supported");
    expect(calls.rpc).toHaveLength(0);
  });

  it("recusa visibilidade de lead sem lead vinculado", async () => {
    const { sb } = fakeSupabase({});
    await expect(
      createMeeting({
        sb,
        session: session(),
        scope: OWNER_SCOPE,
        source: "record",
        mimeType: "audio/webm",
        visibility: "lead",
      }),
    ).rejects.toThrow("meeting_lead_visibility_requires_lead");
  });

  it("nao carimba equipe quando o colaborador esta em varias", async () => {
    const { sb, calls } = fakeSupabase({
      teamRows: [{ team_id: "team-1" }, { team_id: "team-2" }],
    });
    await createMeeting({
      sb,
      session: session({ organizationRole: "director", employeeId: "emp-dir" }),
      scope: { kind: "teams", teamIds: ["team-1", "team-2"] },
      source: "record",
      mimeType: "audio/webm",
    });
    // Escolher uma das duas colocaria a reuniao no recorte errado.
    expect(calls.rpc[0]?.params.p_team_id).toBeNull();
  });

  it("carimba a equipe quando o colaborador esta em exatamente uma", async () => {
    const { sb, calls } = fakeSupabase({ teamRows: [{ team_id: "team-1" }] });
    await createMeeting({
      sb,
      session: session({ organizationRole: "manager", employeeId: "emp-mgr" }),
      scope: { kind: "teams", teamIds: ["team-1"] },
      source: "record",
      mimeType: "audio/webm",
    });
    expect(calls.rpc[0]?.params.p_team_id).toBe("team-1");
  });
});

// ── listMeetingsForSession ──────────────────────────────────────────────────

describe("listMeetingsForSession", () => {
  it("nao aplica recorte para o titular", async () => {
    const { sb, calls } = fakeSupabase({ meetingList: [] });
    await listMeetingsForSession({ sb, session: session(), scope: OWNER_SCOPE });
    expect(calls.or).toHaveLength(0);
  });

  it("manda o recorte para a query, nao para a memoria", async () => {
    const { sb, calls } = fakeSupabase({ meetingList: [] });
    await listMeetingsForSession({
      sb,
      session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
      scope: SELLER_SCOPE,
    });
    expect(calls.or).toHaveLength(1);
    expect(calls.or[0]).toContain("created_by_employee_id.eq.emp-seller");
  });

  it("neutraliza caracteres que quebrariam a expressao do PostgREST na busca", async () => {
    const { sb } = fakeSupabase({ meetingList: [] });
    await expect(
      listMeetingsForSession({
        sb,
        session: session(),
        scope: OWNER_SCOPE,
        filters: { search: "reuniao,%\\ teste" },
      }),
    ).resolves.toBeDefined();
  });

  it("sinaliza proxima pagina sem precisar de count", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `m-${i}`,
      tenant_id: "tenant-a",
      status: "completed",
      visibility: "company",
      source: "record",
    }));
    const { sb } = fakeSupabase({ meetingList: rows });
    const result = await listMeetingsForSession({
      sb,
      session: session(),
      scope: OWNER_SCOPE,
      filters: { limit: 2 },
    });
    expect(result.meetings).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });
});

// ── updateMeetingForSession ─────────────────────────────────────────────────

describe("updateMeetingForSession", () => {
  const existing = {
    id: "m-1",
    tenant_id: "tenant-a",
    created_by_employee_id: null,
    team_id: "team-1",
    lead_id: "lead-1",
    visibility: "lead",
    status: "completed",
    source: "record",
  };

  it("rebaixa para privada ao desvincular o lead de uma reuniao com visibilidade de lead", async () => {
    const { sb, calls } = fakeSupabase({ meetingRow: existing });
    await updateMeetingForSession({
      sb,
      session: session(),
      scope: OWNER_SCOPE,
      meetingId: "m-1",
      patch: { leadId: null },
    });
    const patch = calls.updates.at(-1);
    expect(patch?.lead_id).toBeNull();
    // Sem isso a reuniao ficaria invisivel para todos menos o titular.
    expect(patch?.visibility).toBe("private");
  });

  it("recusa vincular a um lead fora do escopo, mesmo na propria reuniao", async () => {
    // O vendedor e AUTOR (por isso alcanca a reuniao), mas o lead que ele tenta
    // vincular e de um colega. Vincular exporia a gravacao a quem cuida daquele
    // lead — e confirmaria que ele existe.
    const { sb } = fakeSupabase({
      meetingRow: { ...existing, created_by_employee_id: "emp-seller", visibility: "private", lead_id: null },
      leadRow: { team_id: "team-9", owner_employee_id: "emp-outro" },
    });
    await expect(
      updateMeetingForSession({
        sb,
        session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
        scope: SELLER_SCOPE,
        meetingId: "m-1",
        patch: { leadId: "lead-de-outro" },
      }),
    ).rejects.toThrow("meeting_lead_not_found");
  });

  it("nao deixa editar reuniao que a pessoa nem alcanca", async () => {
    // Precede a validacao do lead: quem nao ve, nao edita.
    const { sb } = fakeSupabase({
      meetingRow: existing,
      leadRow: { team_id: "team-9", owner_employee_id: "emp-outro" },
    });
    const result = await updateMeetingForSession({
      sb,
      session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
      scope: SELLER_SCOPE,
      meetingId: "m-1",
      patch: { leadId: "lead-de-outro" },
    });
    expect(result).toBeNull();
  });

  it("devolve null quando a reuniao esta fora do escopo", async () => {
    const { sb } = fakeSupabase({ meetingRow: null });
    const result = await updateMeetingForSession({
      sb,
      session: session({ organizationRole: "seller", employeeId: "emp-seller" }),
      scope: SELLER_SCOPE,
      meetingId: "m-de-outro",
      patch: { title: "novo" },
    });
    expect(result).toBeNull();
  });

  it("recusa tipo de reuniao com formato invalido", async () => {
    const { sb } = fakeSupabase({ meetingRow: existing });
    await expect(
      updateMeetingForSession({
        sb,
        session: session(),
        scope: OWNER_SCOPE,
        meetingId: "m-1",
        patch: { meetingType: "Reunião Comercial!" },
      }),
    ).rejects.toThrow("meeting_type_invalid");
  });
});
