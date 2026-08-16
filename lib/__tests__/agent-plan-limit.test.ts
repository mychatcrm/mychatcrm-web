import { describe, expect, it } from "vitest";
import { describeAgentActivationBlock } from "@/lib/server/agent-plan-limit";
import { getPlanPolicy } from "@/lib/plan-policy";

type SbArg = Parameters<typeof describeAgentActivationBlock>[0]["sb"];

/** Plano Solo inclui 2 agentes (lib/plan-policy.ts). */
const SOLO_SESSION = { tenantId: "tenant-a", plan: "solo" as const };

function fakeSupabase(options: {
  extras?: number;
  extrasError?: { code: string; message: string };
  otherActiveAgents?: number;
  /** Agentes de Disparos ativos, contados em cota separada. */
  otherActiveBroadcastAgents?: number;
  countError?: { code: string; message: string };
}): SbArg {
  const client = {
    from(table: string) {
      if (table === "stripe_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.extras === undefined ? null : { extra_agents_purchased: options.extras },
                error: options.extrasError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === "tenant_agents") {
        // A contagem passou a ler linhas (e não `count`) porque precisa
        // separar agente normal de agente de Disparos pelo metadata.
        const rows = [
          ...Array.from({ length: options.otherActiveAgents ?? 0 }, (_, i) => ({
            agent_id: `ag-${i}`,
            isBroadcastAgent: null,
          })),
          ...Array.from({ length: options.otherActiveBroadcastAgents ?? 0 }, (_, i) => ({
            agent_id: `bc-${i}`,
            isBroadcastAgent: "true",
          })),
        ];
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({
                  data: options.countError ? null : rows,
                  error: options.countError ?? null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
  return client as unknown as SbArg;
}

describe("describeAgentActivationBlock", () => {
  it("libera quando o agente está sendo salvo como pausado", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 99 }),
      session: SOLO_SESSION,
      agentId: "ag-1",
      willBeActive: false,
    });

    expect(block).toBeNull();
  });

  it("libera quando ainda há vaga ativa no plano", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 1 }),
      session: SOLO_SESSION,
      agentId: "ag-novo",
      willBeActive: true,
    });

    expect(block).toBeNull();
  });

  it("bloqueia quando ativar passaria do teto do plano", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 2 }),
      session: SOLO_SESSION,
      agentId: "ag-duplicado",
      willBeActive: true,
    });

    expect(block).toContain("2 agentes ativos");
    expect(block).toContain("já tem 2");
  });

  it("soma agentes extras comprados ao teto do plano", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 2, extras: 3 }),
      session: SOLO_SESSION,
      agentId: "ag-extra",
      willBeActive: true,
    });

    expect(block).toBeNull();
  });

  it("não conta o próprio agente duas vezes ao regravar um agente já ativo", async () => {
    // A contagem exclui `agentId`; com 1 outro ativo no plano Solo ainda cabe.
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 1 }),
      session: SOLO_SESSION,
      agentId: "ag-ja-ativo",
      willBeActive: true,
    });

    expect(block).toBeNull();
  });

  it("não bloqueia o cliente quando a própria contagem falha", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ countError: { code: "42501", message: "permission denied" } }),
      session: SOLO_SESSION,
      agentId: "ag-1",
      willBeActive: true,
    });

    expect(block).toBeNull();
  });

  it("trata falha na consulta de extras como zero extras", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({
        otherActiveAgents: 2,
        extrasError: { code: "42501", message: "permission denied" },
      }),
      session: SOLO_SESSION,
      agentId: "ag-1",
      willBeActive: true,
    });

    expect(block).toContain("2 agentes ativos");
  });
});

describe("cota separada do agente de Disparos", () => {
  // O agente de Disparos resgata base antiga com prompt próprio; o normal
  // atende lead novo. Dividirem a mesma cota tirava metade do atendimento do
  // plano Solo só para poder disparar.
  it("agente de Disparos NÃO consome vaga de agente normal", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 2 }), // Solo já no teto de atendimento
      session: SOLO_SESSION,
      agentId: "disparos-default",
      willBeActive: true,
      isBroadcastAgent: true,
    });

    expect(block).toBeNull();
  });

  it("agente normal NÃO é liberado por sobra na cota de Disparos", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveAgents: 2, otherActiveBroadcastAgents: 0 }),
      session: SOLO_SESSION,
      agentId: "ag-novo",
      willBeActive: true,
    });

    expect(block).toContain("2 agentes ativos");
  });

  it("segundo agente de Disparos é bloqueado no teto de 1", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveBroadcastAgents: 1 }),
      session: SOLO_SESSION,
      agentId: "disparos-2",
      willBeActive: true,
      isBroadcastAgent: true,
    });

    expect(block).toContain("Disparos");
    expect(block).toContain("1 agente de Disparos ativo");
  });

  it("agente de Disparos pausado nunca bloqueia", async () => {
    const block = await describeAgentActivationBlock({
      sb: fakeSupabase({ otherActiveBroadcastAgents: 99 }),
      session: SOLO_SESSION,
      agentId: "disparos-2",
      willBeActive: false,
      isBroadcastAgent: true,
    });

    expect(block).toBeNull();
  });

  it("todos os planos incluem 1 agente de Disparos", () => {
    for (const plan of ["solo", "equipa", "escala", "enterprise"] as const) {
      expect(getPlanPolicy(plan).includedBroadcastAgents).toBe(1);
    }
  });
});
