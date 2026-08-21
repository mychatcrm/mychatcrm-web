import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bug encontrado ao ligar a tela que finalmente permite criar mais de um
 * agente de Disparos: `describeAgentActivationBlock` sempre soube cobrar cota
 * separada via seu parâmetro `isBroadcastAgent` (lib/server/agent-plan-limit.ts),
 * mas nenhuma das duas rotas genéricas de agente passava esse parâmetro —
 * então todo agente de Disparos criado por ali contava (incorretamente) na
 * cota de atendimento, e a cota própria de Disparos nunca era aplicada.
 *
 * Teste de contrato (não integração): confirma que as duas rotas calculam
 * `isBroadcastAgent` a partir do payload recebido e passam pra
 * `describeAgentActivationBlock`. A lógica pura da cota já tem cobertura em
 * agent-plan-limit.test.ts — o que faltava era só isto.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("cota de agente de Disparos chega até as rotas genéricas de agente", () => {
  it("POST /api/client/agentes passa isBroadcastAgent", () => {
    const route = source("app/api/client/agentes/route.ts");
    expect(route).toContain("isBroadcastAgentMetadata");
    const isBroadcastLine = route.indexOf("const isBroadcastAgent =");
    const callSite = route.indexOf("describeAgentActivationBlock({");
    expect(isBroadcastLine).toBeGreaterThan(-1);
    expect(callSite).toBeGreaterThan(isBroadcastLine);
    expect(route.slice(callSite, callSite + 300)).toContain("isBroadcastAgent,");
  });

  it("PUT /api/client/agentes/[id] passa isBroadcastAgent", () => {
    const route = source("app/api/client/agentes/[id]/route.ts");
    expect(route).toContain("isBroadcastAgentMetadata");
    const isBroadcastLine = route.indexOf("const isBroadcastAgent =");
    const callSite = route.indexOf("describeAgentActivationBlock({");
    expect(isBroadcastLine).toBeGreaterThan(-1);
    expect(callSite).toBeGreaterThan(isBroadcastLine);
    expect(route.slice(callSite, callSite + 300)).toContain("isBroadcastAgent,");
  });

  it("as duas rotas reconhecem o id fixo herdado, não só o metadata novo", () => {
    for (const path of ["app/api/client/agentes/route.ts", "app/api/client/agentes/[id]/route.ts"]) {
      expect(source(path)).toContain("DISPAROS_DEFAULT_AGENT_ID");
    }
  });
});
