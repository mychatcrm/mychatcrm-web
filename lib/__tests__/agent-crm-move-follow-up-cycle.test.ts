import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAgentCrmMove, resolveAgentCrmMoveTarget } from "@/lib/server/agent-crm-move";

/**
 * Movimentação do card ao longo do ciclo de follow-up.
 *
 * Três momentos novos, todos opcionais e todos configurados pelo dono do
 * agente: o follow-up disparou, as tentativas esgotaram, e o lead esgotado
 * voltou a falar. Nada tem padrão — agente sem config não move nada.
 *
 * O que estes testes seguram:
 *  - nenhum dos três liga sozinho, nem com config pela metade;
 *  - todos dependem do follow-up estar ativo (sem ele o evento não existe);
 *  - a automação não desfaz card arrastado à mão pela equipe;
 *  - o ciclo é repetível: responder de novo volta a mover.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const CYCLE_ACTIONS = [
  {
    action: "follow_up_sent" as const,
    enabledKey: "crmMoveOnFollowUpEnabled",
    funnelKey: "crmFollowUpFunnelId",
    columnKey: "crmFollowUpColumnId",
  },
  {
    action: "follow_up_exhausted" as const,
    enabledKey: "crmMoveOnExhaustedEnabled",
    funnelKey: "crmExhaustedFunnelId",
    columnKey: "crmExhaustedColumnId",
  },
  {
    action: "lead_returned_after_exhausted" as const,
    enabledKey: "crmMoveOnReturnAfterExhaustedEnabled",
    funnelKey: "crmReturnFunnelId",
    columnKey: "crmReturnColumnId",
  },
];

function metadataFor(
  rule: (typeof CYCLE_ACTIONS)[number],
  overrides: Record<string, unknown> = {},
  followUpOverrides: Record<string, unknown> = {},
) {
  return {
    followUpInteligente: {
      ativo: true,
      [rule.enabledKey]: true,
      [rule.funnelKey]: `funil-${rule.action}`,
      [rule.columnKey]: `coluna-${rule.action}`,
      ...overrides,
    },
    ...followUpOverrides,
  };
}

describe.each(CYCLE_ACTIONS)("resolveAgentCrmMoveTarget — $action", (rule) => {
  it("resolve o destino quando está ligado e completo", () => {
    expect(resolveAgentCrmMoveTarget(metadataFor(rule), rule.action)).toEqual({
      funnelId: `funil-${rule.action}`,
      columnId: `coluna-${rule.action}`,
    });
  });

  it("não move desligado", () => {
    expect(
      resolveAgentCrmMoveTarget(metadataFor(rule, { [rule.enabledKey]: false }), rule.action),
    ).toBeNull();
  });

  it("não move com funil ou coluna faltando", () => {
    expect(
      resolveAgentCrmMoveTarget(metadataFor(rule, { [rule.funnelKey]: null }), rule.action),
    ).toBeNull();
    expect(
      resolveAgentCrmMoveTarget(metadataFor(rule, { [rule.columnKey]: "   " }), rule.action),
    ).toBeNull();
  });

  it("não move com o follow-up desligado", () => {
    // Sem follow-up ativo nenhum destes momentos acontece; honrar a config aí
    // seria mover o card por um evento que nunca vai existir.
    expect(
      resolveAgentCrmMoveTarget(metadataFor(rule, { ativo: false }), rule.action),
    ).toBeNull();
  });

  it("não move quando a config está fora de followUpInteligente", () => {
    // Estes três moram dentro do bloco de follow-up. Um campo solto na raiz do
    // metadata é config de outro destino — não pode ser lido por engano.
    const raiz = {
      [rule.enabledKey]: true,
      [rule.funnelKey]: "funil-solto",
      [rule.columnKey]: "coluna-solta",
    };
    expect(resolveAgentCrmMoveTarget(raiz, rule.action)).toBeNull();
  });
});

describe("os três destinos do ciclo são independentes entre si", () => {
  it("ligar o do disparo não liga o do esgotamento nem o do retorno", () => {
    const metadata = metadataFor(CYCLE_ACTIONS[0]!);
    expect(resolveAgentCrmMoveTarget(metadata, "follow_up_sent")).not.toBeNull();
    expect(resolveAgentCrmMoveTarget(metadata, "follow_up_exhausted")).toBeNull();
    expect(resolveAgentCrmMoveTarget(metadata, "lead_returned_after_exhausted")).toBeNull();
  });

  it("o retorno tem destino próprio, diferente da resposta comum", () => {
    const metadata = {
      crmMoveOnLeadReplyEnabled: true,
      crmReplyFunnelId: "funil-resposta",
      crmReplyColumnId: "em-atendimento",
      followUpInteligente: {
        ativo: true,
        crmMoveOnReturnAfterExhaustedEnabled: true,
        crmReturnFunnelId: "funil-resgate",
        crmReturnColumnId: "recuperado",
      },
    };
    expect(resolveAgentCrmMoveTarget(metadata, "lead_replied")).toEqual({
      funnelId: "funil-resposta",
      columnId: "em-atendimento",
    });
    expect(resolveAgentCrmMoveTarget(metadata, "lead_returned_after_exhausted")).toEqual({
      funnelId: "funil-resgate",
      columnId: "recuperado",
    });
  });

  it("agente sem nenhuma config não move em nenhum dos momentos", () => {
    for (const rule of CYCLE_ACTIONS) {
      expect(resolveAgentCrmMoveTarget({}, rule.action)).toBeNull();
      expect(resolveAgentCrmMoveTarget({ followUpInteligente: { ativo: true } }, rule.action)).toBeNull();
    }
  });
});

/**
 * Supabase mínimo para `applyAgentCrmMove`: devolve o metadata do agente e o
 * estado atual do card, e registra os updates aplicados em `leads`.
 */
function makeSb(options: {
  metadata: Record<string, unknown>;
  status: string | null;
  agentColumnId: string | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const chain = <T>(value: T) => {
    const node: Record<string, unknown> = {
      maybeSingle: async () => value,
    };
    node.eq = () => node;
    node.limit = () => node;
    return node;
  };

  const sb = {
    from(table: string) {
      return {
        select() {
          if (table === "tenant_agents") {
            return chain({ data: { metadata: options.metadata }, error: null });
          }
          return chain({
            data: {
              id: "lead-1",
              status: options.status,
              agent_crm_column_id: options.agentColumnId,
            },
            error: null,
          });
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          const node: Record<string, unknown> = { error: null };
          node.eq = () => node;
          node.is = () => node;
          return Object.assign(Promise.resolve({ error: null }), node);
        },
      };
    },
  };

  return { sb: sb as never, updates };
}

const FOLLOW_UP_METADATA = {
  followUpInteligente: {
    ativo: true,
    crmMoveOnFollowUpEnabled: true,
    crmFollowUpFunnelId: "funil-1",
    crmFollowUpColumnId: "em-retomada",
  },
};

describe("applyAgentCrmMove — dono do card", () => {
  it("move e carimba a procedência quando o agente nunca mexeu no card", async () => {
    const { sb, updates } = makeSb({
      metadata: FOLLOW_UP_METADATA,
      status: "em-atendimento",
      agentColumnId: null,
    });

    const result = await applyAgentCrmMove({
      sb,
      tenantId: "tenant-1",
      action: "follow_up_sent",
      agentId: "agente-1",
      leadId: "lead-1",
    });

    expect(result).toBe("moved");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: "em-retomada",
      crm_funnel_id: "funil-1",
      agent_crm_column_id: "em-retomada",
    });
  });

  it("move de novo quando o card está onde o próprio agente deixou", async () => {
    // É isso que fecha o ciclo: respondeu → sumiu → follow-up → respondeu de novo.
    const { sb, updates } = makeSb({
      metadata: FOLLOW_UP_METADATA,
      status: "em-atendimento",
      agentColumnId: "em-atendimento",
    });

    const result = await applyAgentCrmMove({
      sb,
      tenantId: "tenant-1",
      action: "follow_up_sent",
      agentId: "agente-1",
      leadId: "lead-1",
    });

    expect(result).toBe("moved");
    expect(updates[0]).toMatchObject({ status: "em-retomada" });
  });

  it("NÃO move card arrastado à mão pela equipe", async () => {
    // O agente deixou em `em-atendimento`, alguém arrastou para `negociacao`:
    // a partir daí o card é da equipe e a automação não encosta mais nele.
    const { sb, updates } = makeSb({
      metadata: FOLLOW_UP_METADATA,
      status: "negociacao",
      agentColumnId: "em-atendimento",
    });

    const result = await applyAgentCrmMove({
      sb,
      tenantId: "tenant-1",
      action: "follow_up_sent",
      agentId: "agente-1",
      leadId: "lead-1",
    });

    expect(result).toBe("skipped");
    expect(updates).toHaveLength(0);
  });

  it("não regrava quando o card já está no destino", async () => {
    const { sb, updates } = makeSb({
      metadata: FOLLOW_UP_METADATA,
      status: "em-retomada",
      agentColumnId: "em-retomada",
    });

    const result = await applyAgentCrmMove({
      sb,
      tenantId: "tenant-1",
      action: "follow_up_sent",
      agentId: "agente-1",
      leadId: "lead-1",
    });

    expect(result).toBe("skipped");
    expect(updates).toHaveLength(0);
  });

  it("não move quando o dono do agente não configurou o destino", async () => {
    const { sb, updates } = makeSb({
      metadata: { followUpInteligente: { ativo: true } },
      status: "novo",
      agentColumnId: null,
    });

    const result = await applyAgentCrmMove({
      sb,
      tenantId: "tenant-1",
      action: "follow_up_sent",
      agentId: "agente-1",
      leadId: "lead-1",
    });

    expect(result).toBe("skipped");
    expect(updates).toHaveLength(0);
  });
});

describe("contrato: de onde saem as ações do ciclo", () => {
  const jobsSource = source("lib/server/follow-up-jobs.ts");

  it("as duas ações de follow-up saem de processFollowUpJob", () => {
    // Se saírem de outro lugar, o card se move sem que uma mensagem de
    // follow-up tenha de fato sido enviada.
    expect(jobsSource).toContain('action: "follow_up_sent"');
    expect(jobsSource).toContain('action: "follow_up_exhausted"');
    const processIndex = jobsSource.indexOf("async function processFollowUpJob");
    expect(processIndex).toBeGreaterThan(-1);
    expect(jobsSource.indexOf('action: "follow_up_sent"')).toBeGreaterThan(processIndex);
    expect(jobsSource.indexOf('action: "follow_up_exhausted"')).toBeGreaterThan(processIndex);
  });

  it("o move do esgotamento vem depois de gravar follow_up_status no lead", () => {
    // Ordem importa: se o move viesse antes, um retorno do lead logo em seguida
    // ainda leria o status antigo e seria tratado como resposta comum.
    const statusIndex = jobsSource.indexOf('follow_up_status: settings.desativarAposEncerrar');
    const moveIndex = jobsSource.indexOf('action: "follow_up_exhausted"');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(moveIndex).toBeGreaterThan(statusIndex);
  });

  it("o move do disparo não roda na tentativa que esgota", () => {
    // Senão o card passaria pela coluna de retomada e pela de esgotado na mesma
    // execução, e o vendedor veria um pulo sem sentido no quadro.
    expect(jobsSource).toContain("nextAttempts < job.max_attempts");
  });
});
