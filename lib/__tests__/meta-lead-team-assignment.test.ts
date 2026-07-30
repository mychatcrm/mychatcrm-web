import { describe, expect, it } from "vitest";
import {
  buildLeadTeamPatch,
  EMPTY_RULE_ASSIGNMENT,
  loadRuleTeamAssignment,
  type RuleTeamAssignment,
} from "@/lib/server/meta-lead-team-assignment";

function fakeSupabase(options: {
  row?: Record<string, unknown> | null;
  error?: string;
  onQuery?: (table: string) => void;
}) {
  return {
    from(table: string) {
      options.onQuery?.(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: options.row ?? null,
            error: options.error ? { message: options.error } : null,
          }),
      };
      return chain;
    },
  } as never;
}

describe("loadRuleTeamAssignment", () => {
  it("não consulta nada quando o lead entrou sem regra", async () => {
    let consultou = false;
    const sb = fakeSupabase({
      onQuery: () => {
        consultou = true;
      },
    });
    expect(await loadRuleTeamAssignment(sb, "tenant-a", null)).toEqual(EMPTY_RULE_ASSIGNMENT);
    expect(consultou).toBe(false);
  });

  it("devolve a equipe da regra", async () => {
    const sb = fakeSupabase({
      row: { team_id: "team-1", distribution_type: "automation_agent", employee_ids: [] },
    });
    expect(await loadRuleTeamAssignment(sb, "tenant-a", "rule-1")).toEqual({
      teamId: "team-1",
      sellerId: null,
    });
  });

  it("devolve equipe e vendedor no modo IA + Vendedor", async () => {
    const sb = fakeSupabase({
      row: { team_id: "team-1", distribution_type: "agent_plus_seller", employee_ids: ["sel-1"] },
    });
    expect(await loadRuleTeamAssignment(sb, "tenant-a", "rule-1")).toEqual({
      teamId: "team-1",
      sellerId: "sel-1",
    });
  });

  it("ignora vendedor quando o modo não é IA + Vendedor", async () => {
    const sb = fakeSupabase({
      row: { team_id: "team-1", distribution_type: "specific_employees", employee_ids: ["sel-1", "sel-2"] },
    });
    const result = await loadRuleTeamAssignment(sb, "tenant-a", "rule-1");
    expect(result.sellerId).toBeNull();
  });

  it("não quebra a ingestão quando a consulta da regra falha", async () => {
    const sb = fakeSupabase({ error: "boom" });
    expect(await loadRuleTeamAssignment(sb, "tenant-a", "rule-1")).toEqual(EMPTY_RULE_ASSIGNMENT);
  });

  it("trata regra sem equipe como sem carimbo", async () => {
    const sb = fakeSupabase({
      row: { team_id: null, distribution_type: "agent_plus_seller", employee_ids: ["sel-1"] },
    });
    expect(await loadRuleTeamAssignment(sb, "tenant-a", "rule-1")).toEqual({
      teamId: null,
      sellerId: "sel-1",
    });
  });
});

describe("buildLeadTeamPatch", () => {
  const comVendedor: RuleTeamAssignment = { teamId: "team-1", sellerId: "sel-1" };
  const soEquipe: RuleTeamAssignment = { teamId: "team-1", sellerId: null };

  it("carimba equipe e vendedor no lead novo", () => {
    expect(buildLeadTeamPatch({ assignment: comVendedor, isNewLead: true })).toEqual({
      team_id: "team-1",
      owner_employee_id: "sel-1",
    });
  });

  it("carimba só a equipe quando a regra não designa vendedor", () => {
    expect(buildLeadTeamPatch({ assignment: soEquipe, isNewLead: true })).toEqual({
      team_id: "team-1",
    });
  });

  it("NÃO move lead que já pertence a outra equipe", () => {
    const patch = buildLeadTeamPatch({
      assignment: comVendedor,
      isNewLead: false,
      currentTeamId: "team-9",
      currentOwnerEmployeeId: "sel-9",
    });
    expect(patch).toEqual({});
  });

  it("adota lead antigo que estava órfão", () => {
    const patch = buildLeadTeamPatch({
      assignment: comVendedor,
      isNewLead: false,
      currentTeamId: null,
      currentOwnerEmployeeId: null,
    });
    expect(patch).toEqual({ team_id: "team-1", owner_employee_id: "sel-1" });
  });

  it("preenche só a equipe quando o lead já tem dono", () => {
    const patch = buildLeadTeamPatch({
      assignment: comVendedor,
      isNewLead: false,
      currentTeamId: null,
      currentOwnerEmployeeId: "sel-9",
    });
    expect(patch).toEqual({ team_id: "team-1" });
  });

  it("não devolve nada quando a regra não tem equipe nem vendedor", () => {
    expect(buildLeadTeamPatch({ assignment: EMPTY_RULE_ASSIGNMENT, isNewLead: true })).toEqual({});
  });
});
