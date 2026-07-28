import { describe, expect, it } from "vitest";
import { describeAgentActivationBlock } from "@/lib/server/agent-plan-limit";

type SbArg = Parameters<typeof describeAgentActivationBlock>[0]["sb"];

/** Plano Solo inclui 2 agentes (lib/plan-policy.ts). */
const SOLO_SESSION = { tenantId: "tenant-a", plan: "solo" as const };

function fakeSupabase(options: {
  extras?: number;
  extrasError?: { code: string; message: string };
  otherActiveAgents?: number;
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
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({
                  count: options.otherActiveAgents ?? 0,
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
