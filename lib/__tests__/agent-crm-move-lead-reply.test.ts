import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentCrmMoveTarget } from "@/lib/server/agent-crm-move";

/**
 * Destino do agente quando o lead RESPONDE.
 *
 * Dois contratos importam aqui e nenhum é óbvio lendo só a assinatura:
 *  1. este destino não pode depender da agenda (o move de agendamento depende);
 *  2. quem trava a repetição é a procedência do card (`agent_crm_column_id`),
 *     não o carimbo de primeira resposta — senão o ciclo respondeu → sumiu →
 *     follow-up → respondeu de novo nunca fecharia.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const REPLY_CONFIG = {
  crmMoveOnLeadReplyEnabled: true,
  crmReplyFunnelId: "funil-x",
  crmReplyColumnId: "coluna-y",
};

describe("resolveAgentCrmMoveTarget — lead_replied", () => {
  it("resolve o destino quando está ligado e completo", () => {
    expect(resolveAgentCrmMoveTarget(REPLY_CONFIG, "lead_replied")).toEqual({
      funnelId: "funil-x",
      columnId: "coluna-y",
    });
  });

  it("não move com a opção desligada", () => {
    expect(
      resolveAgentCrmMoveTarget({ ...REPLY_CONFIG, crmMoveOnLeadReplyEnabled: false }, "lead_replied"),
    ).toBeNull();
  });

  it("não move com funil ou coluna faltando", () => {
    expect(
      resolveAgentCrmMoveTarget({ ...REPLY_CONFIG, crmReplyFunnelId: null }, "lead_replied"),
    ).toBeNull();
    expect(
      resolveAgentCrmMoveTarget({ ...REPLY_CONFIG, crmReplyColumnId: "  " }, "lead_replied"),
    ).toBeNull();
  });

  it("NÃO exige agendaAutomationEnabled — este destino não tem relação com a agenda", () => {
    expect(resolveAgentCrmMoveTarget(REPLY_CONFIG, "lead_replied")).not.toBeNull();
    expect(
      resolveAgentCrmMoveTarget({ ...REPLY_CONFIG, agendaAutomationEnabled: false }, "lead_replied"),
    ).not.toBeNull();
  });

  it("é independente do destino do primeiro contato", () => {
    // Só o destino da resposta ligado: o do primeiro contato desligado não bloqueia.
    const metadata = { ...REPLY_CONFIG, crmAutoMoveEnabled: false };
    expect(resolveAgentCrmMoveTarget(metadata, "lead_replied")).toEqual({
      funnelId: "funil-x",
      columnId: "coluna-y",
    });
  });

  it("config da agenda não vaza para a ação de resposta e vice-versa", () => {
    const agendaOnly = {
      agendaAutomationEnabled: true,
      agendaCrmMoveOnScheduleEnabled: true,
      agendaCrmScheduleFunnelId: "funil-agenda",
      agendaCrmScheduleColumnId: "agendado",
    };
    expect(resolveAgentCrmMoveTarget(agendaOnly, "lead_replied")).toBeNull();
    expect(resolveAgentCrmMoveTarget(REPLY_CONFIG, "scheduled")).toBeNull();
  });
});

describe("contrato: move na resposta do lead", () => {
  const moveSource = source("lib/server/agent-crm-move.ts");

  it("carimba first_reply_at com escrita condicional (não sobrescreve o original)", () => {
    expect(moveSource).toContain('.is("first_reply_at", null)');
  });

  it("first_reply_at é registro, não trava: o move não depende do resultado do carimbo", () => {
    // Se o carimbo voltasse a ser a condição, o segundo ciclo de follow-up
    // deixaria o card parado para sempre na coluna de retomada.
    expect(moveSource).not.toContain("claimFirstReply");
    expect(moveSource).toContain("stampFirstReply");
  });

  it("decide a ação pelo estado do follow-up do lead", () => {
    // Lead que já tinha esgotado e volta a falar é lead recuperado: destino
    // próprio, não o destino de resposta comum.
    expect(moveSource).toContain("loadFollowUpStatus");
    expect(moveSource).toContain("lead_returned_after_exhausted");
  });

  it("é chamado nos DOIS caminhos de resposta (QR e API Meta)", () => {
    // Se entrar só num, o comportamento muda conforme o método de conexão da
    // linha — que é exatamente o tipo de diferença invisível que gera bug.
    expect(source("lib/server/evolution-agent-reply.ts")).toContain("applyCrmMoveOnLeadReply");
    expect(source("lib/server/meta-agent-reply.ts")).toContain("applyCrmMoveOnLeadReply");
  });
});
