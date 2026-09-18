import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCentralAccessMock,
  runMetaLeadReconciliationMock,
  loadLatestReconciliationRunMock,
  loadReconciliationGapsMock,
  backfillReconciliationGapsMock,
} = vi.hoisted(() => ({
  requireCentralAccessMock: vi.fn(),
  runMetaLeadReconciliationMock: vi.fn(),
  loadLatestReconciliationRunMock: vi.fn(),
  loadReconciliationGapsMock: vi.fn(),
  backfillReconciliationGapsMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-lead-central-guard", () => ({
  requireCentralAccess: requireCentralAccessMock,
  actorLabel: (session: { employeeId?: string }) => session.employeeId ?? "owner",
}));
vi.mock("@/lib/server/meta-lead-reconciliation", () => ({
  RECONCILIATION_MAX_DAYS: 90,
  runMetaLeadReconciliation: runMetaLeadReconciliationMock,
  loadLatestReconciliationRun: loadLatestReconciliationRunMock,
  loadReconciliationGaps: loadReconciliationGapsMock,
  backfillReconciliationGaps: backfillReconciliationGapsMock,
}));

import { NextRequest } from "next/server";
import { GET as readRoute, POST as runRoute } from "@/app/api/client/meta/reconciliation/route";
import { POST as backfillRoute } from "@/app/api/client/meta/reconciliation/backfill/route";

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body) } as never) as never;
}

function allowOwner() {
  requireCentralAccessMock.mockResolvedValue({
    ok: true,
    session: { tenantId: "tenant-1" },
    sb: {},
    scope: { kind: "all" },
    canSeeSpend: true,
  });
}

function allowManager() {
  requireCentralAccessMock.mockResolvedValue({
    ok: true,
    session: { tenantId: "tenant-1", employeeId: "emp-1", organizationRole: "manager" },
    sb: {},
    scope: { kind: "teams", teamIds: ["team-1"] },
    canSeeSpend: false,
  });
}

beforeEach(() => {
  requireCentralAccessMock.mockReset();
  runMetaLeadReconciliationMock.mockReset();
  loadLatestReconciliationRunMock.mockReset();
  loadReconciliationGapsMock.mockReset();
  backfillReconciliationGapsMock.mockReset();
  loadLatestReconciliationRunMock.mockResolvedValue(null);
  loadReconciliationGapsMock.mockResolvedValue([]);
});

describe("POST /api/client/meta/reconciliation", () => {
  /**
   * A varredura consome quota da Graph API do cliente e enxerga formulários de
   * toda a conta — inclusive de equipes que um gerente não alcança.
   */
  it("gerente não dispara a reconciliação", async () => {
    allowManager();
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-01", to: "2026-09-17" }),
    );
    expect(response.status).toBe(403);
    expect(runMetaLeadReconciliationMock).not.toHaveBeenCalled();
  });

  it("gerente vê a leitura vazia em vez de um erro", async () => {
    allowManager();
    const response = await readRoute();
    const body = (await response.json()) as { allowed: boolean };
    expect(response.status).toBe(200);
    expect(body.allowed).toBe(false);
  });

  it("recusa período inválido", async () => {
    allowOwner();
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "ontem", to: "hoje" }),
    );
    expect(response.status).toBe(400);
  });

  it("recusa período invertido", async () => {
    allowOwner();
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-30", to: "2026-09-01" }),
    );
    expect(response.status).toBe(400);
  });

  /** Pedir mais do que a Meta guarda gasta quota e devolve um número enganoso. */
  it("recusa janela maior que o limite da Meta", async () => {
    allowOwner();
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-01-01", to: "2026-09-17" }),
    );
    expect(response.status).toBe(422);
    expect(runMetaLeadReconciliationMock).not.toHaveBeenCalled();
  });

  it("execução concorrente responde 409", async () => {
    allowOwner();
    runMetaLeadReconciliationMock.mockRejectedValue(new Error("reconciliation_already_running"));
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-01", to: "2026-09-17" }),
    );
    expect(response.status).toBe(409);
  });

  it("sem conexão Meta responde 422 com instrução", async () => {
    allowOwner();
    runMetaLeadReconciliationMock.mockRejectedValue(new Error("reconciliation_no_connection"));
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-01", to: "2026-09-17" }),
    );
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(422);
    expect(body.error).toContain("Integrações");
  });

  it("migração pendente responde 503", async () => {
    allowOwner();
    runMetaLeadReconciliationMock.mockRejectedValue(new Error("reconciliation_schema_pending"));
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-01", to: "2026-09-17" }),
    );
    expect(response.status).toBe(503);
  });

  it("período válido chega à camada de serviço", async () => {
    allowOwner();
    runMetaLeadReconciliationMock.mockResolvedValue({ run: { id: "run-1" }, gaps: [] });
    const response = await runRoute(
      post("https://x.test/api/client/meta/reconciliation", { from: "2026-09-01", to: "2026-09-17" }),
    );
    expect(response.status).toBe(200);
    const [args] = runMetaLeadReconciliationMock.mock.calls[0] as [{ from: string; to: string }];
    expect(args).toMatchObject({ from: "2026-09-01", to: "2026-09-17" });
  });
});

describe("POST /api/client/meta/reconciliation/backfill", () => {
  it("gerente não importa leads em falta", async () => {
    allowManager();
    const response = await backfillRoute(
      post("https://x.test/api/client/meta/reconciliation/backfill", { runId: "run-1" }),
    );
    expect(response.status).toBe(403);
    expect(backfillReconciliationGapsMock).not.toHaveBeenCalled();
  });

  it("exige a execução de origem", async () => {
    allowOwner();
    const response = await backfillRoute(
      post("https://x.test/api/client/meta/reconciliation/backfill", {}),
    );
    expect(response.status).toBe(400);
  });

  /** O disparo em lote para leads antigos é opt-in explícito, nunca o padrão. */
  it("sem pedido explícito não aciona o agente", async () => {
    allowOwner();
    backfillReconciliationGapsMock.mockResolvedValue({ imported: 3, failed: 0, skipped: 0 });

    await backfillRoute(post("https://x.test/api/client/meta/reconciliation/backfill", { runId: "run-1" }));

    const [args] = backfillReconciliationGapsMock.mock.calls[0] as [{ withOutreach: boolean }];
    expect(args.withOutreach).toBe(false);
  });

  it("aciona o agente quando pedido em texto claro", async () => {
    allowOwner();
    backfillReconciliationGapsMock.mockResolvedValue({ imported: 1, failed: 0, skipped: 0 });

    await backfillRoute(
      post("https://x.test/api/client/meta/reconciliation/backfill", {
        runId: "run-1",
        withOutreach: true,
      }),
    );

    const [args] = backfillReconciliationGapsMock.mock.calls[0] as [{ withOutreach: boolean }];
    expect(args.withOutreach).toBe(true);
  });

  it("valor não booleano não liga o disparo por acidente", async () => {
    allowOwner();
    backfillReconciliationGapsMock.mockResolvedValue({ imported: 1, failed: 0, skipped: 0 });

    await backfillRoute(
      post("https://x.test/api/client/meta/reconciliation/backfill", {
        runId: "run-1",
        withOutreach: "sim",
      }),
    );

    const [args] = backfillReconciliationGapsMock.mock.calls[0] as [{ withOutreach: boolean }];
    expect(args.withOutreach).toBe(false);
  });

  it("limita o lote de ids", async () => {
    allowOwner();
    backfillReconciliationGapsMock.mockResolvedValue({ imported: 0, failed: 0, skipped: 0 });

    await backfillRoute(
      post("https://x.test/api/client/meta/reconciliation/backfill", {
        runId: "run-1",
        gapIds: Array.from({ length: 900 }, (_, index) => `gap-${index}`),
      }),
    );

    const [args] = backfillReconciliationGapsMock.mock.calls[0] as [{ gapIds: string[] }];
    expect(args.gapIds).toHaveLength(500);
  });
});
