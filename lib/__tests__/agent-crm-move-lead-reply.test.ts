import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentCrmMoveTarget } from "@/lib/server/agent-crm-move";

/**
 * Segundo destino do agente: mover o card quando o lead RESPONDE.
 *
 * Dois contratos importam aqui e nenhum é óbvio lendo só a assinatura:
 *  1. este destino não pode depender da agenda (o move de agendamento depende);
 *  2. move só na PRIMEIRA resposta — senão cada mensagem nova do lead desfaria
 *     o que a equipe moveu à mão.
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

describe("contrato: move da primeira resposta", () => {
  const moveSource = source("lib/server/agent-crm-move.ts");

  it("reivindica first_reply_at com escrita condicional (uma vez só, à prova de corrida)", () => {
    // Sem o `.is(..., null)` a reivindicação deixaria de ser atômica e duas
    // mensagens simultâneas moveriam o card duas vezes.
    expect(moveSource).toContain('.is("first_reply_at", null)');
  });

  it("só move depois de reivindicar o carimbo", () => {
    const claimIndex = moveSource.indexOf("claimFirstReply");
    const applyIndex = moveSource.indexOf("applyCrmMoveOnFirstLeadReply");
    expect(claimIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(-1);
  });

  it("é chamado nos DOIS caminhos de resposta (QR e API Meta)", () => {
    // Se entrar só num, o comportamento muda conforme o método de conexão da
    // linha — que é exatamente o tipo de diferença invisível que gera bug.
    expect(source("lib/server/evolution-agent-reply.ts")).toContain("applyCrmMoveOnFirstLeadReply");
    expect(source("lib/server/meta-agent-reply.ts")).toContain("applyCrmMoveOnFirstLeadReply");
  });
});
