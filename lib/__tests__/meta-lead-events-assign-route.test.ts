import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireCentralAccessMock,
  loadCentralEventInScopeMock,
  assignMetaLeadEventToAgentMock,
  assignMetaLeadEventToEmployeeMock,
} = vi.hoisted(() => ({
  requireCentralAccessMock: vi.fn(),
  loadCentralEventInScopeMock: vi.fn(),
  assignMetaLeadEventToAgentMock: vi.fn(),
  assignMetaLeadEventToEmployeeMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-lead-central-guard", () => ({
  requireCentralAccess: requireCentralAccessMock,
  actorLabel: (session: { employeeId?: string }) => session.employeeId ?? "owner",
}));
vi.mock("@/lib/server/meta-lead-central-actions", () => ({
  loadCentralEventInScope: loadCentralEventInScopeMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/server/meta-lead-manual-assignment", () => ({
  assignMetaLeadEventToAgent: assignMetaLeadEventToAgentMock,
  assignMetaLeadEventToEmployee: assignMetaLeadEventToEmployeeMock,
}));

/** Sessão autorizada com o evento dentro do recorte — o caso normal. */
function allowSession() {
  requireCentralAccessMock.mockResolvedValue({
    ok: true,
    session: { tenantId: "tenant-1" },
    sb: {},
    scope: { kind: "all" },
    canSeeSpend: true,
  });
  loadCentralEventInScopeMock.mockResolvedValue({ id: "event-1", lead_id: "lead-1", leadgen_id: "lg-1" });
}

import { POST } from "@/app/api/client/meta/lead-events/[id]/assign/route";

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/meta/lead-events/event-1/assign", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/client/meta/lead-events/[id]/assign", () => {
  beforeEach(() => {
    requireCentralAccessMock.mockReset();
    loadCentralEventInScopeMock.mockReset();
    assignMetaLeadEventToAgentMock.mockReset();
    assignMetaLeadEventToEmployeeMock.mockReset();
  });

  it("returns 401 without a session", async () => {
    requireCentralAccessMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });

    const res = await POST(makeRequest({ target: "agent", agentId: "a1" }), ctx("event-1"));

    expect(res.status).toBe(401);
    expect(assignMetaLeadEventToAgentMock).not.toHaveBeenCalled();
  });

  it("returns the underlying function's status/error for a blocked assignment", async () => {
    allowSession();
    assignMetaLeadEventToAgentMock.mockResolvedValue({ ok: false, error: "Lead não encontrado.", status: 404 });

    const res = await POST(makeRequest({ target: "agent", agentId: "a1" }), ctx("event-1"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Lead não encontrado." });
  });

  it("routes target=agent to assignMetaLeadEventToAgent with the right args", async () => {
    allowSession();
    const event = { id: "event-1", current_step: "manual_assigned_to_agent" };
    assignMetaLeadEventToAgentMock.mockResolvedValue({ ok: true, event });

    const res = await POST(makeRequest({ target: "agent", agentId: "agent-9" }), ctx("event-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, event });
    expect(assignMetaLeadEventToAgentMock).toHaveBeenCalledWith({
      sb: {},
      tenantId: "tenant-1",
      eventId: "event-1",
      agentId: "agent-9",
    });
    expect(assignMetaLeadEventToEmployeeMock).not.toHaveBeenCalled();
  });

  it("routes target=employee to assignMetaLeadEventToEmployee with the right args", async () => {
    allowSession();
    const event = { id: "event-1", current_step: "manual_assigned_to_human" };
    assignMetaLeadEventToEmployeeMock.mockResolvedValue({ ok: true, event });

    const res = await POST(makeRequest({ target: "employee", employeeId: "emp-9" }), ctx("event-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, event });
    expect(assignMetaLeadEventToEmployeeMock).toHaveBeenCalledWith({
      sb: {},
      tenantId: "tenant-1",
      eventId: "event-1",
      employeeId: "emp-9",
    });
  });

  it("returns 400 for an unrecognized target", async () => {
    allowSession();

    const res = await POST(makeRequest({ target: "bogus" }), ctx("event-1"));

    expect(res.status).toBe(400);
    expect(assignMetaLeadEventToAgentMock).not.toHaveBeenCalled();
    expect(assignMetaLeadEventToEmployeeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the event is outside the caller's access scope", async () => {
    requireCentralAccessMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", employeeId: "emp-outsider" },
      sb: {},
      scope: { kind: "own", employeeId: "emp-outsider" },
      canSeeSpend: false,
    });
    loadCentralEventInScopeMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ target: "agent", agentId: "agent-9" }), ctx("event-1"));

    expect(res.status).toBe(404);
    expect(assignMetaLeadEventToAgentMock).not.toHaveBeenCalled();
    expect(assignMetaLeadEventToEmployeeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    allowSession();
    const req = new Request("https://example.test", { method: "POST", body: "{not json" }) as never;

    const res = await POST(req, ctx("event-1"));

    expect(res.status).toBe(400);
  });
});
