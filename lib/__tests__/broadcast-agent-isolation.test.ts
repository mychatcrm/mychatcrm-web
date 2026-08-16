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
 * Agente de Disparos e agente de atendimento não se misturam.
 *
 * O de Disparos resgata base antiga com prompt próprio e vira dono da conversa
 * de quem responde; o de atendimento cuida de lead novo. Trocar um pelo outro
 * joga base fria dentro do funil de lead novo (ou o contrário), que é o dano
 * que esta separação existe para impedir.
 *
 * As duas pontas precisam de trava, porque a UI sozinha não protege: qualquer
 * POST direto na API passaria por cima do dropdown.
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

describe("contrato: as duas pontas do isolamento", () => {
  it("regra de distribuição recusa agente de Disparos", () => {
    // Sem isto, lead novo cairia no prompt de resgate de base antiga.
    const rules = source("app/api/client/lead-rules/route.ts");
    expect(rules).toContain("rejectBroadcastAgentsInRule");
    expect(rules).toContain("isBroadcastAgentRow");
    // Roda no POST, antes de gravar.
    const guardIndex = rules.indexOf("await rejectBroadcastAgentsInRule");
    expect(guardIndex).toBeGreaterThan(-1);
  });

  it("campanha recusa agente de atendimento", () => {
    // Sem isto, o agente normal viraria dono da conversa de resgate e a base
    // antiga entraria no funil de lead novo.
    const campaigns = source("lib/server/whatsapp-campaigns.ts");
    expect(campaigns).toContain("campaign_agent_not_broadcast");
    expect(campaigns).toContain("isBroadcastAgentRow");
  });

  it("o erro da campanha tem mensagem traduzida para o cliente", () => {
    // Código cru vazando na tela é o mesmo que erro silencioso.
    expect(source("app/api/client/whatsapp-campaigns/route.ts")).toContain(
      "campaign_agent_not_broadcast",
    );
  });

  it("o dropdown de agentes de atendimento filtra pela marca, não pelo id fixo", () => {
    // Do segundo agente de Disparos em diante os ids são gerados; filtrar por
    // id deixaria os novos vazarem para o dropdown de atendimento.
    const route = source("app/api/client/whatsapp-campaigns/route.ts");
    expect(route).toContain("isBroadcastAgentRow");
    expect(route).not.toContain('.neq("agent_id", DISPAROS_DEFAULT_AGENT_ID)');
  });
});
