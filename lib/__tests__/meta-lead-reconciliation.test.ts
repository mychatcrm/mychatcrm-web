import { beforeEach, describe, expect, it, vi } from "vitest";

const { metaGraphRequestMock, processMetaLeadgenEventMock, appendAuditMock } = vi.hoisted(() => ({
  metaGraphRequestMock: vi.fn(),
  processMetaLeadgenEventMock: vi.fn(),
  appendAuditMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-graph-api", () => ({
  metaGraphRequest: metaGraphRequestMock,
  metaGraphErrorCode: (error: unknown) => (error instanceof Error ? error.message : "unknown"),
}));
vi.mock("@/lib/server/meta-lead-ingest", () => ({
  processMetaLeadgenEvent: processMetaLeadgenEventMock,
}));
vi.mock("@/lib/server/operational-audit", () => ({
  appendOperationalAuditEvent: appendAuditMock,
}));

import {
  backfillReconciliationGaps,
  runMetaLeadReconciliation,
} from "@/lib/server/meta-lead-reconciliation";

type TableData = {
  meta_connections?: unknown[];
  meta_lead_events?: unknown[];
  meta_lead_reconciliation_runs?: Record<string, unknown> | null;
  meta_lead_reconciliation_gaps?: unknown[];
};

function makeSupabase(data: TableData, options: { runInsertError?: { code: string; message: string } } = {}) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};

  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => {
          if (table === "meta_lead_events") {
            return Promise.resolve({ data: data.meta_lead_events ?? [], error: null });
          }
          return builder;
        },
        order: () => builder,
        insert(payload: unknown) {
          inserted[table] = [...(inserted[table] ?? []), payload];
          if (table === "meta_lead_reconciliation_runs" && options.runInsertError) {
            return {
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: options.runInsertError }),
              }),
            };
          }
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: data.meta_lead_reconciliation_runs ?? null,
                  error: null,
                }),
            }),
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })),
          };
        },
        update(payload: unknown) {
          updated[table] = [...(updated[table] ?? []), payload];
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: data.meta_lead_reconciliation_runs ?? null, error: null }),
              }),
              then: (resolve: (value: { data: null; error: null }) => unknown) =>
                Promise.resolve(resolve({ data: null, error: null })),
            }),
          };
        },
        limit: (count: number) => {
          if (table === "meta_connections") {
            return Promise.resolve({ data: (data.meta_connections ?? []).slice(0, count), error: null });
          }
          if (table === "meta_lead_reconciliation_gaps") {
            return Promise.resolve({ data: (data.meta_lead_reconciliation_gaps ?? []).slice(0, count), error: null });
          }
          return {
            maybeSingle: () =>
              Promise.resolve({ data: data.meta_lead_reconciliation_runs ?? null, error: null }),
          };
        },
        maybeSingle: () =>
          Promise.resolve({ data: data.meta_lead_reconciliation_runs ?? null, error: null }),
      };
      return builder;
    },
  };

  return { client: client as never, inserted, updated };
}

const RUN = {
  id: "run-1",
  tenant_id: "tenant-1",
  period_from: "2026-09-01",
  period_to: "2026-09-17",
  timezone: "America/Sao_Paulo",
  status: "running",
  pages_checked: 0,
  forms_checked: 0,
  meta_total: 0,
  local_total: 0,
  missing_total: 0,
  imported_total: 0,
  error_code: null,
  error_message: null,
  started_at: "2026-09-17T10:00:00Z",
  finished_at: null,
  started_by: "owner",
};

const CONNECTION = {
  tenant_id: "tenant-1",
  page_id: "page-1",
  page_name: "Página",
  page_access_token: "token-1",
};

beforeEach(() => {
  metaGraphRequestMock.mockReset();
  processMetaLeadgenEventMock.mockReset();
  appendAuditMock.mockReset();
  appendAuditMock.mockResolvedValue(null);
});

describe("runMetaLeadReconciliation", () => {
  it("acusa como faltante o lead que a Meta tem e a base não", async () => {
    metaGraphRequestMock
      .mockResolvedValueOnce({ data: [{ id: "form-1", name: "Form 1" }] })
      .mockResolvedValueOnce({
        data: [
          { id: "lg-1", created_time: "2026-09-10T10:00:00+0000" },
          { id: "lg-2", created_time: "2026-09-11T10:00:00+0000" },
        ],
      });

    const { client, inserted } = makeSupabase({
      meta_connections: [CONNECTION],
      meta_lead_events: [{ leadgen_id: "lg-1" }],
      meta_lead_reconciliation_runs: RUN,
      meta_lead_reconciliation_gaps: [],
    });

    const result = await runMetaLeadReconciliation({
      sb: client,
      tenantId: "tenant-1",
      from: "2026-09-01",
      to: "2026-09-17",
      timezone: "America/Sao_Paulo",
      startedBy: "owner",
    });

    const gapsInserted = inserted.meta_lead_reconciliation_gaps?.[0] as Array<{ leadgen_id: string }>;
    expect(gapsInserted).toHaveLength(1);
    expect(gapsInserted[0]?.leadgen_id).toBe("lg-2");
    expect(result.run.id).toBe("run-1");
  });

  it("descarta lead posterior ao fim do período — o filtro da Graph só corta o início", async () => {
    metaGraphRequestMock
      .mockResolvedValueOnce({ data: [{ id: "form-1", name: "Form 1" }] })
      .mockResolvedValueOnce({
        data: [
          { id: "lg-dentro", created_time: "2026-09-10T10:00:00+0000" },
          { id: "lg-fora", created_time: "2026-09-25T10:00:00+0000" },
        ],
      });

    const { client, inserted } = makeSupabase({
      meta_connections: [CONNECTION],
      meta_lead_events: [],
      meta_lead_reconciliation_runs: RUN,
    });

    await runMetaLeadReconciliation({
      sb: client,
      tenantId: "tenant-1",
      from: "2026-09-01",
      to: "2026-09-17",
      timezone: "America/Sao_Paulo",
      startedBy: "owner",
    });

    const gapsInserted = inserted.meta_lead_reconciliation_gaps?.[0] as Array<{ leadgen_id: string }>;
    expect(gapsInserted.map((gap) => gap.leadgen_id)).toEqual(["lg-dentro"]);
  });

  it("uma página sem permissão não cancela as outras — resultado fica parcial", async () => {
    metaGraphRequestMock.mockRejectedValueOnce(new Error("permission_denied"));

    const { client, updated } = makeSupabase({
      meta_connections: [CONNECTION],
      meta_lead_events: [],
      meta_lead_reconciliation_runs: RUN,
    });

    await runMetaLeadReconciliation({
      sb: client,
      tenantId: "tenant-1",
      from: "2026-09-01",
      to: "2026-09-17",
      timezone: "America/Sao_Paulo",
      startedBy: "owner",
    });

    const patch = updated.meta_lead_reconciliation_runs?.[0] as { status?: string };
    expect(patch.status).toBe("partial");
  });

  it("sem conexão Meta falha com código próprio e marca a execução", async () => {
    const { client, updated } = makeSupabase({
      meta_connections: [],
      meta_lead_reconciliation_runs: RUN,
    });

    await expect(
      runMetaLeadReconciliation({
        sb: client,
        tenantId: "tenant-1",
        from: "2026-09-01",
        to: "2026-09-17",
        timezone: "America/Sao_Paulo",
        startedBy: "owner",
      }),
    ).rejects.toThrow("reconciliation_no_connection");

    const patch = updated.meta_lead_reconciliation_runs?.[0] as { status?: string };
    expect(patch.status).toBe("failed");
  });

  it("execução concorrente é recusada pelo índice único", async () => {
    const { client } = makeSupabase(
      { meta_connections: [CONNECTION] },
      { runInsertError: { code: "23505", message: "duplicate key" } },
    );

    await expect(
      runMetaLeadReconciliation({
        sb: client,
        tenantId: "tenant-1",
        from: "2026-09-01",
        to: "2026-09-17",
        timezone: "America/Sao_Paulo",
        startedBy: "owner",
      }),
    ).rejects.toThrow("reconciliation_already_running");
  });

  it("sem a migração aplicada devolve código próprio", async () => {
    const { client } = makeSupabase(
      { meta_connections: [CONNECTION] },
      { runInsertError: { code: "42P01", message: "relation does not exist" } },
    );

    await expect(
      runMetaLeadReconciliation({
        sb: client,
        tenantId: "tenant-1",
        from: "2026-09-01",
        to: "2026-09-17",
        timezone: "America/Sao_Paulo",
        startedBy: "owner",
      }),
    ).rejects.toThrow("reconciliation_schema_pending");
  });
});

describe("backfillReconciliationGaps", () => {
  const GAPS = [
    { id: "gap-1", page_id: "page-1", form_id: "form-1", leadgen_id: "lg-2", lead_created_time: "2026-09-11T10:00:00Z", ad_id: "ad-1", status: "missing" },
  ];

  it("importa sem acionar o agente por padrão", async () => {
    processMetaLeadgenEventMock.mockResolvedValue(undefined);
    const { client } = makeSupabase({
      meta_lead_reconciliation_gaps: GAPS,
      meta_lead_reconciliation_runs: { ...RUN, imported_total: 0 },
    });

    const result = await backfillReconciliationGaps({
      sb: client,
      tenantId: "tenant-1",
      runId: "run-1",
      actorId: "owner",
    });

    expect(result.imported).toBe(1);
    expect(processMetaLeadgenEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ leadgen_id: "lg-2", page_id: "page-1" }),
      expect.objectContaining({ suppressOutreach: true }),
    );
  });

  it("aciona o agente só quando pedido explicitamente", async () => {
    processMetaLeadgenEventMock.mockResolvedValue(undefined);
    const { client } = makeSupabase({
      meta_lead_reconciliation_gaps: GAPS,
      meta_lead_reconciliation_runs: { ...RUN, imported_total: 0 },
    });

    await backfillReconciliationGaps({
      sb: client,
      tenantId: "tenant-1",
      runId: "run-1",
      actorId: "owner",
      withOutreach: true,
    });

    expect(processMetaLeadgenEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ suppressOutreach: false }),
    );
  });

  it("falha de um lead não derruba o lote", async () => {
    processMetaLeadgenEventMock.mockRejectedValue(new Error("graph_timeout"));
    const { client, updated } = makeSupabase({
      meta_lead_reconciliation_gaps: GAPS,
      meta_lead_reconciliation_runs: { ...RUN, imported_total: 0 },
    });

    const result = await backfillReconciliationGaps({
      sb: client,
      tenantId: "tenant-1",
      runId: "run-1",
      actorId: "owner",
    });

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    const patch = updated.meta_lead_reconciliation_gaps?.[0] as { status?: string };
    expect(patch.status).toBe("import_failed");
  });

  it("converte a data do lead para segundos, como o webhook manda", async () => {
    processMetaLeadgenEventMock.mockResolvedValue(undefined);
    const { client } = makeSupabase({
      meta_lead_reconciliation_gaps: GAPS,
      meta_lead_reconciliation_runs: { ...RUN, imported_total: 0 },
    });

    await backfillReconciliationGaps({ sb: client, tenantId: "tenant-1", runId: "run-1", actorId: "owner" });

    const [value] = processMetaLeadgenEventMock.mock.calls[0] as [{ created_time?: number }];
    expect(value.created_time).toBe(Math.floor(new Date("2026-09-11T10:00:00Z").getTime() / 1000));
  });
});
