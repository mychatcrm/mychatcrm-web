import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROADCAST_AGENT_METADATA_KEY,
  DISPAROS_DEFAULT_AGENT_ID,
  isBroadcastAgentMetadata,
  isBroadcastAgentProjection,
  isBroadcastAgentRow,
} from "@/lib/server/broadcast-agent-identity";

/**
 * Agente de Disparos e agente de atendimento.
 *
 * A tela de disparos passou a usar só os agentes já criados em Meus Agentes
 * (sem categoria própria, sem criar agente por lá) — ver
 * lib/server/whatsapp-campaigns.ts e app/api/client/whatsapp-campaigns/route.ts.
 * `isBroadcastAgentRow`/`isBroadcastAgentMetadata` continuam existindo porque
 * a regra de distribuição de leads ainda recusa um agente marcado como
 * Disparos (linhas legadas ou marcadas manualmente), e a cota separada em
 * agent-plan-limit.ts também depende da marca.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("identidade do agente de Disparos", () => {
  it("reconhece pela marca no metadata", () => {
    expect(isBroadcastAgentMetadata({ [BROADCAST_AGENT_METADATA_KEY]: true })).toBe(true);
    expect(isBroadcastAgentMetadata({ [BROADCAST_AGENT_METADATA_KEY]: false })).toBe(false);
    expect(isBroadcastAgentMetadata({})).toBe(false);
  });

  it("nunca quebra com metadata que não é objeto", () => {
    // Vem de jsonb do banco — nunca confiar no formato.
    for (const bad of [null, undefined, "texto", 42, [], true]) {
      expect(isBroadcastAgentMetadata(bad)).toBe(false);
    }
  });

  it("reconhece o agente herdado, criado antes da marca existir", () => {
    // O primeiro agente de Disparos de cada tenant nasceu com id fixo e sem
    // metadata. Sem este caso ele cairia na cota de atendimento.
    expect(isBroadcastAgentRow({ agent_id: DISPAROS_DEFAULT_AGENT_ID })).toBe(true);
    expect(isBroadcastAgentRow({ agent_id: DISPAROS_DEFAULT_AGENT_ID, metadata: {} })).toBe(true);
  });

  it("agente de atendimento nunca é confundido com o de Disparos", () => {
    expect(isBroadcastAgentRow({ agent_id: "ag-novo-123", metadata: {} })).toBe(false);
    expect(isBroadcastAgentRow({ agent_id: "ag-novo-123" })).toBe(false);
    // Nome parecido não basta: a marca é o que vale.
    expect(isBroadcastAgentRow({ agent_id: "disparos-parecido", metadata: {} })).toBe(false);
  });

  it("a projeção enxuta concorda com a leitura do metadata completo", () => {
    // PostgREST devolve `metadata->>chave` como TEXTO, daí a comparação com "true".
    expect(isBroadcastAgentProjection({ agent_id: "bc-1", isBroadcastAgent: "true" })).toBe(true);
    expect(isBroadcastAgentProjection({ agent_id: "ag-1", isBroadcastAgent: null })).toBe(false);
    expect(isBroadcastAgentProjection({ agent_id: DISPAROS_DEFAULT_AGENT_ID })).toBe(true);
  });
});

describe("contrato: regra de distribuição ainda recusa agente marcado como Disparos", () => {
  it("regra de distribuição recusa agente de Disparos", () => {
    // Sem isto, lead novo cairia no prompt de resgate de base antiga — vale
    // pra linhas legadas ou marcadas manualmente, mesmo sem UI criando novas.
    const rules = source("app/api/client/lead-rules/route.ts");
    expect(rules).toContain("rejectBroadcastAgentsInRule");
    expect(rules).toContain("isBroadcastAgentRow");
    // Roda no POST, antes de gravar.
    const guardIndex = rules.indexOf("await rejectBroadcastAgentsInRule");
    expect(guardIndex).toBeGreaterThan(-1);
  });

  it("a tela de disparos não recusa mais agente de atendimento — agora é a única opção", () => {
    // Confirma a reversão: não sobrou nenhum resquício da exigência antiga.
    const campaigns = source("lib/server/whatsapp-campaigns.ts");
    expect(campaigns).not.toContain("campaign_agent_not_broadcast");
    expect(campaigns).not.toContain("isBroadcastAgentRow");
  });
});
