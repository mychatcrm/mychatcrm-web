import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressão do "agente mudo depois da resposta do lead":
 * tryProcessAgentResponseJob revalidava a elegibilidade SEM passar o
 * journey_id do próprio job. Com isolamento de jornadas ligado (produção),
 * a revalidação devolvia "missing_active_journey" e cancelava TODO job de
 * smart wait — a primeira mensagem (outreach) saía, o lead respondia e o
 * agente nunca mais respondia. Visto em produção: job 40b473b3 cancelado
 * 300ms após o claim com a jornada 976f449b ativa no banco.
 */

const {
  createSupabaseServiceClientMock,
  authorizeActiveJourneyMock,
  isAgentAutomationAllowedMock,
  processAgentResponseJobMock,
  canAgentAutoContactLeadMock,
} = vi.hoisted(() => ({
  createSupabaseServiceClientMock: vi.fn(),
  authorizeActiveJourneyMock: vi.fn(),
  isAgentAutomationAllowedMock: vi.fn(),
  processAgentResponseJobMock: vi.fn(),
  canAgentAutoContactLeadMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));
vi.mock("@/lib/server/lead-journeys", () => ({
  authorizeActiveJourney: authorizeActiveJourneyMock,
  isJourneyIsolationEnabled: () => true,
}));
vi.mock("@/lib/server/conversation-operation", () => ({
  isAgentAutomationAllowed: isAgentAutomationAllowedMock,
}));
vi.mock("@/lib/server/agent-auto-contact-guard", () => ({
  canAgentAutoContactLead: canAgentAutoContactLeadMock,
}));
vi.mock("@/lib/server/evolution-agent-reply", () => ({
  processAgentResponseJob: processAgentResponseJobMock,
}));

import { tryProcessAgentResponseJob } from "@/lib/server/agent-response-jobs";

const JOURNEY_ID = "976f449b-4a06-43cd-81f8-96d21923334b";
const JOB_ID = "40b473b3-9ff2-4e4a-9ad8-4db33a231197";

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const past = new Date(Date.now() - 10_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  return {
    id: JOB_ID,
    tenant_id: "tenant-1",
    lead_id: "lead-1",
    journey_id: JOURNEY_ID,
    remote_jid: "5562982194839@s.whatsapp.net",
    agent_id: "agent-1",
    instance_name: "mc-instance",
    status: "pending",
    first_message_at: past,
    last_message_at: past,
    scheduled_for: past,
    max_wait_until: future,
    message_ids: [],
    inbound_message_count: 1,
    attempt_count: 0,
    burst_generation: 1,
    locked_at: null,
    completed_at: null,
    failed_reason: null,
    created_at: past,
    updated_at: past,
    ...overrides,
  };
}

type Update = { payload: Record<string, unknown> };

/**
 * Builder fake do supabase: devolve maybeSingle() de uma fila e registra
 * os updates aplicados em agent_response_jobs para as asserções.
 */
function makeSb(maybeSingleQueue: Array<Record<string, unknown> | null>, updates: Update[]) {
  const makeBuilder = () => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.lte = () => builder;
    builder.lt = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.update = (payload: Record<string, unknown>) => {
      pendingUpdate = payload;
      updates.push({ payload });
      return builder;
    };
    builder.maybeSingle = async () => {
      const next = maybeSingleQueue.shift() ?? null;
      // Claim (update → select → maybeSingle) devolve a linha "processing".
      if (pendingUpdate && next) return { data: { ...next, ...pendingUpdate }, error: null };
      return { data: next, error: null };
    };
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return builder;
  };
  return { from: () => makeBuilder() } as never;
}

describe("tryProcessAgentResponseJob — revalidação de jornada", () => {
  beforeEach(() => {
    authorizeActiveJourneyMock.mockReset();
    isAgentAutomationAllowedMock.mockReset();
    processAgentResponseJobMock.mockReset();
    canAgentAutoContactLeadMock.mockReset();
    isAgentAutomationAllowedMock.mockResolvedValue({ ok: true });
    canAgentAutoContactLeadMock.mockResolvedValue({ ok: true });
  });

  it("processa (não cancela) job com jornada ativa válida — passa o journey_id do job na revalidação", async () => {
    authorizeActiveJourneyMock.mockResolvedValue({
      ok: true,
      agentId: "agent-1",
      journey: { id: JOURNEY_ID },
    });
    processAgentResponseJobMock.mockResolvedValue({ ok: true, dedupedCount: 0 });

    const updates: Update[] = [];
    const sb = makeSb(
      [
        jobRow(), // claim: leitura do pending
        jobRow({ status: "processing" }), // claim: update devolve processing
        { burst_generation: 1, status: "processing" }, // isJobGenerationStale
      ],
      updates,
    );

    const outcome = await tryProcessAgentResponseJob(JOB_ID, sb);

    expect(outcome).toBe("processed");
    expect(processAgentResponseJobMock).toHaveBeenCalledTimes(1);
    // A revalidação chegou a consultar a jornada (não caiu no curto-circuito
    // "missing_active_journey" por falta de journeyId).
    expect(authorizeActiveJourneyMock).toHaveBeenCalled();
    const cancelled = updates.find((u) => u.payload.status === "cancelled");
    expect(cancelled).toBeUndefined();
    const completed = updates.find((u) => u.payload.status === "completed");
    expect(completed).toBeDefined();
  });

  it("ainda cancela com missing_active_journey quando o job realmente não tem jornada", async () => {
    const updates: Update[] = [];
    const sb = makeSb(
      [
        jobRow({ journey_id: null }),
        jobRow({ journey_id: null, status: "processing" }),
      ],
      updates,
    );

    const outcome = await tryProcessAgentResponseJob(JOB_ID, sb);

    expect(outcome).toBe("skipped");
    expect(processAgentResponseJobMock).not.toHaveBeenCalled();
    const cancelled = updates.find((u) => u.payload.status === "cancelled");
    expect(cancelled?.payload.failed_reason).toBe("missing_active_journey");
  });

  it("cancela com o motivo real quando a jornada do job foi superada por outra", async () => {
    authorizeActiveJourneyMock.mockResolvedValue({
      ok: true,
      agentId: "agent-1",
      journey: { id: "outra-jornada" },
    });

    const updates: Update[] = [];
    const sb = makeSb(
      [
        jobRow(),
        jobRow({ status: "processing" }),
      ],
      updates,
    );

    const outcome = await tryProcessAgentResponseJob(JOB_ID, sb);

    expect(outcome).toBe("skipped");
    expect(processAgentResponseJobMock).not.toHaveBeenCalled();
    const cancelled = updates.find((u) => u.payload.status === "cancelled");
    expect(cancelled?.payload.failed_reason).toBe("journey_id_mismatch");
  });
});
