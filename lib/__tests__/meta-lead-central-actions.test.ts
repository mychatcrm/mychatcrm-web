import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendOperationalAuditEventMock } = vi.hoisted(() => ({
  appendOperationalAuditEventMock: vi.fn(),
}));

vi.mock("@/lib/server/operational-audit", () => ({
  appendOperationalAuditEvent: appendOperationalAuditEventMock,
}));

import {
  loadCentralEventInScope,
  setCentralEventsArchived,
} from "@/lib/server/meta-lead-central-actions";
import { resetArchiveSupportCache } from "@/lib/server/meta-lead-central";
import type { AccessScope } from "@/lib/server/access-scope";

type Tables = {
  meta_lead_events?: Record<string, unknown> | null;
  leads?: Record<string, unknown> | null;
};

function makeSupabase(tables: Tables, options: { archiveSupported?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const archiveSupported = options.archiveSupported !== false;

  const client = {
    from(table: string) {
      let isArchiveProbe = false;
      const builder: Record<string, unknown> = {
        select(columns: string) {
          isArchiveProbe = table === "meta_lead_events" && columns === "archived_at";
          return builder;
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return builder;
        },
        eq: () => builder,
        in: () => Promise.resolve({ data: null, error: null }),
        limit: () =>
          Promise.resolve(
            isArchiveProbe && !archiveSupported
              ? { data: null, error: { code: "42703", message: "archived_at does not exist" } }
              : { data: [], error: null },
          ),
        maybeSingle: () =>
          Promise.resolve({
            data: table === "leads" ? (tables.leads ?? null) : (tables.meta_lead_events ?? null),
            error: null,
          }),
      };
      return builder;
    },
  };

  return { client: client as never, updates };
}

const EVENT = { id: "event-1", lead_id: "lead-1", leadgen_id: "lg-1", archived_at: null };

beforeEach(() => {
  resetArchiveSupportCache();
  appendOperationalAuditEventMock.mockReset();
  appendOperationalAuditEventMock.mockResolvedValue(null);
});

describe("loadCentralEventInScope", () => {
  it("titular alcança qualquer evento", async () => {
    const { client } = makeSupabase({ meta_lead_events: EVENT });
    const event = await loadCentralEventInScope(client, "t", "event-1", { kind: "all" });
    expect(event?.id).toBe("event-1");
  });

  it("vendedor alcança o lead que é dele", async () => {
    const { client } = makeSupabase({
      meta_lead_events: EVENT,
      leads: { team_id: "team-1", owner_employee_id: "emp-1", crm_funnel_id: "funil-default" },
    });
    const scope: AccessScope = { kind: "own", employeeId: "emp-1" };
    const event = await loadCentralEventInScope(client, "t", "event-1", scope);
    expect(event?.id).toBe("event-1");
  });

  it("vendedor não alcança lead de colega", async () => {
    const { client } = makeSupabase({
      meta_lead_events: EVENT,
      leads: { team_id: "team-1", owner_employee_id: "emp-outro", crm_funnel_id: "funil-default" },
    });
    const scope: AccessScope = { kind: "own", employeeId: "emp-1" };
    expect(await loadCentralEventInScope(client, "t", "event-1", scope)).toBeNull();
  });

  it("gerente não alcança lead de outra equipe", async () => {
    const { client } = makeSupabase({
      meta_lead_events: EVENT,
      leads: { team_id: "team-9", owner_employee_id: "emp-9", crm_funnel_id: "funil-default" },
    });
    const scope: AccessScope = { kind: "teams", teamIds: ["team-1"] };
    expect(await loadCentralEventInScope(client, "t", "event-1", scope)).toBeNull();
  });

  /** Evento bloqueado antes do CRM não tem lead — só o titular o vê. */
  it("evento sem lead fica restrito ao titular", async () => {
    const { client } = makeSupabase({ meta_lead_events: { ...EVENT, lead_id: null } });
    const scope: AccessScope = { kind: "teams", teamIds: ["team-1"] };
    expect(await loadCentralEventInScope(client, "t", "event-1", scope)).toBeNull();
  });

  it("escopo vazio não alcança nada", async () => {
    const { client } = makeSupabase({ meta_lead_events: EVENT });
    expect(await loadCentralEventInScope(client, "t", "event-1", { kind: "teams", teamIds: [] })).toBeNull();
  });
});

describe("setCentralEventsArchived", () => {
  it("arquiva marcando quem arquivou e registando auditoria", async () => {
    const { client, updates } = makeSupabase({ meta_lead_events: EVENT });

    const result = await setCentralEventsArchived({
      sb: client,
      tenantId: "t",
      eventIds: ["event-1"],
      archived: true,
      actorId: "emp-1",
      scope: { kind: "all" },
    });

    expect(result).toEqual({ ok: true, updated: 1 });
    expect(updates[0]?.archived_at).toEqual(expect.any(String));
    expect(updates[0]?.archived_by).toBe("emp-1");
    expect(appendOperationalAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ module: "leads.central", action: "lead_event.archived" }),
    );
  });

  it("restaurar limpa as duas colunas", async () => {
    const { client, updates } = makeSupabase({ meta_lead_events: { ...EVENT, archived_at: "2026-09-01T00:00:00Z" } });

    await setCentralEventsArchived({
      sb: client,
      tenantId: "t",
      eventIds: ["event-1"],
      archived: false,
      actorId: "owner",
      scope: { kind: "all" },
    });

    expect(updates[0]?.archived_at).toBeNull();
    expect(updates[0]?.archived_by).toBeNull();
  });

  it("sem a migração aplicada avisa em vez de apagar algo", async () => {
    const { client, updates } = makeSupabase({ meta_lead_events: EVENT }, { archiveSupported: false });

    const result = await setCentralEventsArchived({
      sb: client,
      tenantId: "t",
      eventIds: ["event-1"],
      archived: true,
      actorId: "owner",
      scope: { kind: "all" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("schema_pending");
    expect(updates).toHaveLength(0);
  });

  it("ação em massa não toca em lead fora do recorte", async () => {
    const { client, updates } = makeSupabase({
      meta_lead_events: EVENT,
      leads: { team_id: "team-9", owner_employee_id: "emp-9", crm_funnel_id: "f" },
    });

    const result = await setCentralEventsArchived({
      sb: client,
      tenantId: "t",
      eventIds: ["event-1", "event-2"],
      archived: true,
      actorId: "emp-1",
      scope: { kind: "teams", teamIds: ["team-1"] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
    expect(updates).toHaveLength(0);
  });

  it("lista vazia é um não-evento", async () => {
    const { client, updates } = makeSupabase({ meta_lead_events: EVENT });
    const result = await setCentralEventsArchived({
      sb: client, tenantId: "t", eventIds: [], archived: true, actorId: "owner", scope: { kind: "all" },
    });
    expect(result).toEqual({ ok: true, updated: 0 });
    expect(updates).toHaveLength(0);
  });
});
