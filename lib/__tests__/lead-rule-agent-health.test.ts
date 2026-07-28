import { describe, expect, it } from "vitest";
import { classifyRuleAgentIssues, type TenantAgentActivation } from "@/lib/server/lead-rule-agent-health";

function activation(entries: Record<string, boolean>): TenantAgentActivation {
  return new Map(Object.entries(entries));
}

describe("classifyRuleAgentIssues", () => {
  it("não reclama quando o agente existe e está ativo", () => {
    const issues = classifyRuleAgentIssues(["ag-1"], activation({ "ag-1": true }));

    expect(issues).toEqual([]);
  });

  it("aponta agente que não existe mais no tenant", () => {
    // Caso real encontrado em produção: regra ativa apontando para um
    // agent_id apagado; os leads daquele formulário nunca eram atendidos.
    const issues = classifyRuleAgentIssues(["ag-apagado"], activation({ "ag-1": true }));

    expect(issues).toEqual([{ agentId: "ag-apagado", problem: "missing" }]);
  });

  it("aponta agente pausado, que também não atende", () => {
    const issues = classifyRuleAgentIssues(["ag-1"], activation({ "ag-1": false }));

    expect(issues).toEqual([{ agentId: "ag-1", problem: "paused" }]);
  });

  it("não reclama de regra que distribui para colaboradores (sem agentes)", () => {
    expect(classifyRuleAgentIssues([], activation({ "ag-1": true }))).toEqual([]);
  });

  it("reporta cada agente problemático uma única vez", () => {
    const issues = classifyRuleAgentIssues(
      ["ag-sumiu", "ag-sumiu", "ag-pausado"],
      activation({ "ag-pausado": false }),
    );

    expect(issues).toEqual([
      { agentId: "ag-sumiu", problem: "missing" },
      { agentId: "ag-pausado", problem: "paused" },
    ]);
  });

  it("ignora entradas vazias vindas do banco", () => {
    expect(classifyRuleAgentIssues(["", "   "], activation({}))).toEqual([]);
  });
});
