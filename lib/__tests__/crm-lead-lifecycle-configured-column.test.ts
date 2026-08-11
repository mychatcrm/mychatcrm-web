import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O move do primeiro contato passou a respeitar a coluna configurada no agente.
 *
 * Antes ele mandava todo mundo para `contato` fixo, ignorando a escolha feita
 * em «Destino do lead no CRM» — a tela prometia algo que este caminho não
 * cumpria. Estes testes seguram as duas pontas: honrar a config quando existe,
 * e continuar caindo em `contato` para quem nunca configurou nada.
 */

const resolveAgentCrmMoveTarget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auto-lead-upsert", () => ({ resolveAgentCrmMoveTarget }));

import {
  CRM_KANBAN_STATUS_CONTATO,
  CRM_KANBAN_STATUS_NOVO,
  promoteLeadToContatoOnAgentEngagement,
} from "@/lib/server/crm-lead-lifecycle";

/** Supabase mínimo: `select` devolve o lead e `update` grava o patch visto. */
function makeSb(currentStatus: string | null) {
  const updates: Record<string, unknown>[] = [];
  const sb = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: currentStatus === null ? null : { id: "lead-1", status: currentStatus },
                    }),
                  };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            eq() {
              return { eq: async () => ({ error: null }) };
            },
          };
        },
      };
    },
  };
  return { sb: sb as never, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promoteLeadToContatoOnAgentEngagement", () => {
  it("usa a coluna configurada no agente em vez do destino fixo", async () => {
    resolveAgentCrmMoveTarget.mockResolvedValue({
      enabled: true,
      funnelId: "funil-x",
      columnId: "coluna-escolhida",
    });
    const { sb, updates } = makeSb(CRM_KANBAN_STATUS_NOVO);

    const moved = await promoteLeadToContatoOnAgentEngagement({
      sb,
      tenantId: "t1",
      leadId: "lead-1",
      agentId: "ag-1",
    });

    expect(moved).toBe(true);
    expect(updates[0]).toMatchObject({ status: "coluna-escolhida", crm_funnel_id: "funil-x" });
  });

  it("cai no destino padrão quando o agente não configurou nada", async () => {
    resolveAgentCrmMoveTarget.mockResolvedValue({ enabled: false, funnelId: null, columnId: null });
    const { sb, updates } = makeSb(CRM_KANBAN_STATUS_NOVO);

    const moved = await promoteLeadToContatoOnAgentEngagement({
      sb,
      tenantId: "t1",
      leadId: "lead-1",
      agentId: "ag-1",
    });

    expect(moved).toBe(true);
    expect(updates[0]).toMatchObject({ status: CRM_KANBAN_STATUS_CONTATO });
    // Sem config não há funil a impor — não pode sobrescrever o do lead.
    expect(updates[0]).not.toHaveProperty("crm_funnel_id");
  });

  it("não mexe num card que a equipe já moveu para outra etapa", async () => {
    resolveAgentCrmMoveTarget.mockResolvedValue({
      enabled: true,
      funnelId: "funil-x",
      columnId: "coluna-escolhida",
    });
    const { sb, updates } = makeSb("negociacao");

    const moved = await promoteLeadToContatoOnAgentEngagement({
      sb,
      tenantId: "t1",
      leadId: "lead-1",
      agentId: "ag-1",
    });

    expect(moved).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("não regrava quando o lead já está na coluna de destino", async () => {
    resolveAgentCrmMoveTarget.mockResolvedValue({
      enabled: true,
      funnelId: "funil-x",
      columnId: CRM_KANBAN_STATUS_NOVO,
    });
    const { sb, updates } = makeSb(CRM_KANBAN_STATUS_NOVO);

    const moved = await promoteLeadToContatoOnAgentEngagement({
      sb,
      tenantId: "t1",
      leadId: "lead-1",
      agentId: "ag-1",
    });

    expect(moved).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("lead inexistente não vira update", async () => {
    resolveAgentCrmMoveTarget.mockResolvedValue({ enabled: false, funnelId: null, columnId: null });
    const { sb, updates } = makeSb(null);

    const moved = await promoteLeadToContatoOnAgentEngagement({
      sb,
      tenantId: "t1",
      leadId: "lead-1",
      agentId: "ag-1",
    });

    expect(moved).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
