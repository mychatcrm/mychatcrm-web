import { describe, expect, it, vi } from "vitest";
import { syncMetaFormAgentMappingForRule } from "@/lib/server/lead-rules-meta-sync";

describe("syncMetaFormAgentMappingForRule — agent_plus_seller", () => {
  it("materializes the explicit form-to-AI mapping", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    let ruleEqCalls = 0;
    const rulesQuery = {
      select: vi.fn(() => rulesQuery),
      eq: vi.fn(() => {
        ruleEqCalls += 1;
        return ruleEqCalls === 3
          ? Promise.resolve({
              data: [
                {
                  included_form_ids: ["form-1"],
                  agent_ids: ["agent-1"],
                  page_id: "page-1",
                  use_all_forms: false,
                  distribution_type: "agent_plus_seller",
                  active: true,
                  source: "meta_form",
                },
              ],
              error: null,
            })
          : rulesQuery;
      }),
    };
    const mappingQuery = {
      upsert,
      select: vi.fn(() => mappingQuery),
      eq: vi.fn().mockResolvedValue({
        data: [{ form_id: "form-1", agent_id: "agent-1" }],
        error: null,
      }),
    };
    const sb = {
      from: vi.fn((table: string) =>
        table === "lead_distribution_rules" ? rulesQuery : mappingQuery,
      ),
    };

    await syncMetaFormAgentMappingForRule(sb as never, {
      id: "rule-1",
      tenant_id: "tenant-1",
      source: "meta_form",
      distribution_type: "agent_plus_seller",
      agent_ids: ["agent-1"],
      employee_ids: ["seller-1"],
      included_form_ids: ["form-1"],
      excluded_form_ids: [],
      use_all_forms: false,
      page_id: "page-1",
    } as never);

    expect(upsert).toHaveBeenCalledWith(
      [
        {
          tenant_id: "tenant-1",
          form_id: "form-1",
          form_name: null,
          agent_id: "agent-1",
          page_id: "page-1",
        },
      ],
      { onConflict: "tenant_id,form_id" },
    );
  });
});
