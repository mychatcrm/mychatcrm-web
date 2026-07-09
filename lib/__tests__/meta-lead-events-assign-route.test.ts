import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveClientSessionMock, assignMetaLeadEventToAgentMock, assignMetaLeadEventToEmployeeMock } = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  assignMetaLeadEventToAgentMock: vi.fn(),
  assignMetaLeadEventToEmployeeMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/server/meta-lead-manual-assignment", () => ({
  assignMetaLeadEventToAgent: assignMetaLeadEventToAgentMock,
  assignMetaLeadEventToEmployee: assignMetaLeadEventToEmployeeMock,
}));

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
    requireActiveClientSessionMock.mockReset();
    assignMetaLeadEventToAgentMock.mockReset();
    assignMetaLeadEventToEmployeeMock.mockReset();
  });

  it("returns 401 without a session", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });

    const res = await POST(makeRequest({ target: "agent", agentId: "a1" }), ctx("event-1"));

    expect(res.status).toBe(401);
    expect(assignMetaLeadEventToAgentMock).not.toHaveBeenCalled();
  });

  it("returns the underlying function's status/error for a blocked assignment", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
    assignMetaLeadEventToAgentMock.mockResolvedValue({ ok: false, error: "Lead não encontrado.", status: 404 });

    const res = await POST(makeRequest({ target: "agent", agentId: "a1" }), ctx("event-1"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Lead não encontrado." });
  });

  it("routes target=agent to assignMetaLeadEventToAgent with the right args", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
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
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
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
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });

    const res = await POST(makeRequest({ target: "bogus" }), ctx("event-1"));

    expect(res.status).toBe(400);
    expect(assignMetaLeadEventToAgentMock).not.toHaveBeenCalled();
    expect(assignMetaLeadEventToEmployeeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
    const req = new Request("https://example.test", { method: "POST", body: "{not json" }) as never;

    const res = await POST(req, ctx("event-1"));

    expect(res.status).toBe(400);
  });
});
