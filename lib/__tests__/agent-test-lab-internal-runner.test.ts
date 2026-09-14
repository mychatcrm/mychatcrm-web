import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  owner: vi.fn(),
  dispatch: vi.fn(),
  find: vi.fn(),
  runUpdates: [] as Record<string, unknown>[],
  tables: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth-db", () => ({ getAdminSessionByIdFromDb: mocks.owner }));
vi.mock("@/lib/server/agent-test-lab/preflight", () => ({ inspectLabTarget: vi.fn() }));
vi.mock("@/lib/server/agent-test-lab/github", () => ({
  dispatchLabWorkflow: mocks.dispatch,
  findLabWorkflow: mocks.find,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { tickInternalLabRun } from "@/lib/server/agent-test-lab/runs";

const runId = "33333333-3333-4333-8333-333333333333";
const claimToken = "44444444-4444-4444-8444-444444444444";
const deployedSha = "a".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runUpdates = [];
  mocks.tables = [];
  mocks.owner.mockResolvedValue({
    adminId: "admin-renato-lagares",
    role: "super_admin",
    passwordChangedAt: 0,
  });
  mocks.dispatch.mockResolvedValue(undefined);
  mocks.find.mockResolvedValue(null);
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "claim_agent_test_lab_run_v1" ? { claimToken } : true,
    error: null,
  }));
  mocks.from.mockImplementation((table: string) => {
    mocks.tables.push(table);
    let update: Record<string, unknown> | null = null;
    const result = table === "agent_test_lab_runs"
      ? { id: runId, mode: "internal", status: "queued", deployed_sha: deployedSha }
      : null;
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: result, error: null }),
      single: async () => table === "agent_test_lab_steps"
        ? ({ data: { id: "step-1", dispatch_started_at: null, confirmed_at: null }, error: null })
        : ({ data: result, error: null }),
      insert: () => q,
      update: (value: Record<string, unknown>) => {
        update = value;
        if (table === "agent_test_lab_runs") mocks.runUpdates.push(value);
        return q;
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: update, error: null })),
    };
    return q;
  });
});

describe("agent test lab internal runner owner gate", () => {
  it("uses the restricted admin lookup and dispatches the workflow", async () => {
    await tickInternalLabRun(runId);

    expect(mocks.owner).toHaveBeenCalledExactlyOnceWith("admin-renato-lagares");
    expect(mocks.tables).not.toContain("admin_users");
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(runId, "internal", deployedSha);
    expect(mocks.runUpdates.at(-1)).toMatchObject({ result_code: "internal_running" });
  });

  it("fails closed without an active persisted owner", async () => {
    mocks.owner.mockResolvedValue(null);

    await tickInternalLabRun(runId);

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.runUpdates.at(-1)).toMatchObject({
      status: "cancelled",
      verdict: "inconclusive",
      result_code: "owner_or_stop_requested",
    });
  });
});
