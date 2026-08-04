import { describe, expect, it, vi } from "vitest";
import { restoreMetaLeadRuleArtifactsForReadyPages } from "@/lib/server/lead-rules-meta-sync";

describe("Meta rule artifact restore", () => {
  it("recreates capture boundaries only for active rules on ready pages", async () => {
    const rule = {
      id: "00000000-0000-4000-8000-000000000001",
      tenant_id: "tenant-test",
      name: "Meta form",
      source: "meta_form",
      order_index: 0,
      active: true,
      transport: "evolution",
      connection_id: "connection-test",
      meta_template_name: null,
      meta_template_lang: null,
      conflict_policy: "latest_wins",
      conflict_inactivity_minutes: 1440,
      redistribution: false,
      distribution_type: "round_robin",
      team_id: null,
      agent_ids: [],
      employee_ids: [],
      mappings: [],
      page_label: "Page",
      page_id: "page-ready",
      use_all_forms: false,
      excluded_form_ids: [],
      included_form_ids: ["form-a", "form-b"],
      conversion_send_enabled: false,
      conversion_pixel_id: null,
      conversion_api_secret: null,
      redistribution_config: {},
      created_by: null,
      created_at: null,
      updated_at: null,
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data: [rule], error: null }));

    const rpc = vi.fn().mockResolvedValue({ error: null });
    const sb = {
      from: vi.fn(() => builder),
      rpc,
    };

    const result = await restoreMetaLeadRuleArtifactsForReadyPages(
      sb as never,
      "tenant-test",
      ["page-ready", "page-ready", " "],
    );

    expect(result).toEqual({ syncedRuleCount: 1 });
    expect(rpc).toHaveBeenCalledWith("sync_meta_form_capture_boundaries", {
      p_tenant_id: "tenant-test",
      p_rule_id: rule.id,
      p_page_id: "page-ready",
      p_form_ids: ["form-a", "form-b"],
      p_use_all_forms: false,
      p_active: true,
    });
  });
});
