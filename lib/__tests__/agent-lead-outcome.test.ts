import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentTurnPlan } from "@/lib/ai/agent-turn-plan";
import { buildAgentSystemPrompt } from "@/lib/ai/agent-system-prompt";
import {
  leadOutcomePauseReason,
  hasExplicitLeadOutcomeEvidence,
  resolveLeadOutcomeConfig,
} from "@/lib/server/agent-lead-outcome";
import { resolveAgentCrmMoveTarget } from "@/lib/server/agent-crm-move";
import { isStructuralAutomationBlock } from "@/lib/server/conversation-visibility";

/**
 * Descarte de lead: desqualificado e sem interesse.
 *
 * Única automação TERMINAL do agente — encerra o atendimento daquele lead. O
 * que estes testes seguram é justamente o que a torna segura:
 *  - o campo novo no contrato estruturado nunca derruba a resposta ao lead;
 *  - sem critérios escritos pelo cliente, nada acontece (nem no prompt, nem no
 *    efeito);
 *  - o prompt proíbe explicitamente o desfecho quando as automações estão
 *    desligadas;
 *  - o efeito é sempre aplicado DEPOIS do envio da resposta.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const VALID_AGENDA = { action: "none", date: null, time: null, location: null, eventId: null };

describe("contrato estruturado — leadOutcome não pode derrubar o turno", () => {
  it("campo ausente vira none em vez de invalidar o plano", () => {
    const plan = parseAgentTurnPlan({ reply: "Oi!", agenda: VALID_AGENDA });
    expect(plan).not.toBeNull();
    expect(plan?.leadOutcome).toEqual({ action: "none", reason: null });
  });

  it("valor desconhecido vira none", () => {
    const plan = parseAgentTurnPlan({
      reply: "Oi!",
      agenda: VALID_AGENDA,
      leadOutcome: { action: "spam", reason: "x" },
    });
    expect(plan?.leadOutcome).toEqual({ action: "none", reason: null });
  });

  it("tipo errado no bloco inteiro vira none", () => {
    for (const bad of ["disqualified", 42, [], null]) {
      const plan = parseAgentTurnPlan({ reply: "Oi!", agenda: VALID_AGENDA, leadOutcome: bad });
      expect(plan?.leadOutcome).toEqual({ action: "none", reason: null });
    }
  });

  it("none nunca carrega motivo — evita registrar justificativa de coisa nenhuma", () => {
    const plan = parseAgentTurnPlan({
      reply: "Oi!",
      agenda: VALID_AGENDA,
      leadOutcome: { action: "none", reason: "sobrou do turno anterior" },
    });
    expect(plan?.leadOutcome.reason).toBeNull();
  });

  it("desfecho válido chega com o motivo, truncado em 200 caracteres", () => {
    const plan = parseAgentTurnPlan({
      reply: "Entendi, obrigado!",
      agenda: VALID_AGENDA,
      leadOutcome: { action: "lost_interest", reason: "x".repeat(500) },
    });
    expect(plan?.leadOutcome.action).toBe("lost_interest");
    expect(plan?.leadOutcome.reason).toHaveLength(200);
  });
});

describe("resolveLeadOutcomeConfig", () => {
  const full = {
    ativo: true,
    criterios: "Não atende a região X",
    funnelId: "funil-1",
    columnId: "descartado",
    retomarAoVoltar: true,
    notificar: true,
  };

  it("resolve a config completa", () => {
    const resolved = resolveLeadOutcomeConfig(
      { leadOutcomeDisqualified: full },
      "disqualified",
    );
    expect(resolved).toMatchObject({ criterios: "Não atende a região X", retomarAoVoltar: true });
  });

  it("desligada não resolve", () => {
    expect(
      resolveLeadOutcomeConfig({ leadOutcomeDisqualified: { ...full, ativo: false } }, "disqualified"),
    ).toBeNull();
  });

  it("SEM CRITÉRIOS não resolve, mesmo ativa", () => {
    // Sem critérios o prompt não autorizou o desfecho. Se um chegou assim, não
    // tem lastro nenhum e não pode encerrar o atendimento de ninguém.
    expect(
      resolveLeadOutcomeConfig({ leadOutcomeDisqualified: { ...full, criterios: "   " } }, "disqualified"),
    ).toBeNull();
  });

  it("as duas automações são independentes", () => {
    const metadata = { leadOutcomeDisqualified: full };
    expect(resolveLeadOutcomeConfig(metadata, "disqualified")).not.toBeNull();
    expect(resolveLeadOutcomeConfig(metadata, "lost_interest")).toBeNull();
  });

  it("agente sem nada configurado não resolve", () => {
    expect(resolveLeadOutcomeConfig({}, "disqualified")).toBeNull();
    expect(resolveLeadOutcomeConfig(null, "lost_interest")).toBeNull();
  });

  it("toggles opcionais chegam desligados quando ausentes", () => {
    const resolved = resolveLeadOutcomeConfig(
      { leadOutcomeLostInterest: { ativo: true, criterios: "desistiu", funnelId: "f", columnId: "c" } },
      "lost_interest",
    );
    expect(resolved).toMatchObject({ retomarAoVoltar: false, notificar: false });
  });
});

describe("leadOutcomePauseReason", () => {
  it("traduz as duas ações e ignora none", () => {
    expect(leadOutcomePauseReason({ action: "disqualified", reason: null })).toBe("disqualified");
    expect(leadOutcomePauseReason({ action: "lost_interest", reason: null })).toBe("lost_interest");
    expect(leadOutcomePauseReason({ action: "none", reason: null })).toBeNull();
    expect(leadOutcomePauseReason(null)).toBeNull();
  });
});

describe("evidência explícita do desfecho", () => {
  it("aceita somente citação literal acompanhada de justificativa", () => {
    expect(hasExplicitLeadOutcomeEvidence(
      {
        action: "lost_interest",
        reason: "critério configurado atendido",
        evidence: "Não tenho interesse neste momento",
      },
      ["Obrigado, mas não tenho interesse neste momento."],
    )).toBe(true);
    expect(hasExplicitLeadOutcomeEvidence(
      {
        action: "lost_interest",
        reason: "critério configurado atendido",
        evidence: "desistiu da oferta",
      },
      ["Vou pensar e respondo depois"],
    )).toBe(false);
  });

  it("aceita fala curta apenas quando ela é a mensagem inteira", () => {
    const outcome = { action: "lost_interest" as const, reason: "recusa", evidence: "No" };
    expect(hasExplicitLeadOutcomeEvidence(outcome, ["No"])).toBe(true);
    expect(hasExplicitLeadOutcomeEvidence(outcome, ["Not now"])).toBe(false);
  });
});

describe("destino no CRM do descarte", () => {
  const config = {
    ativo: true,
    criterios: "critério do cliente",
    funnelId: "funil-descarte",
    columnId: "perdido",
  };

  it("resolve o destino das duas ações", () => {
    expect(
      resolveAgentCrmMoveTarget({ leadOutcomeDisqualified: config }, "lead_disqualified"),
    ).toEqual({ funnelId: "funil-descarte", columnId: "perdido" });
    expect(
      resolveAgentCrmMoveTarget({ leadOutcomeLostInterest: config }, "lead_lost_interest"),
    ).toEqual({ funnelId: "funil-descarte", columnId: "perdido" });
  });

  it("não move sem critérios, sem coluna ou desligado", () => {
    for (const broken of [
      { ...config, criterios: "" },
      { ...config, columnId: null },
      { ...config, funnelId: "  " },
      { ...config, ativo: false },
    ]) {
      expect(
        resolveAgentCrmMoveTarget({ leadOutcomeDisqualified: broken }, "lead_disqualified"),
      ).toBeNull();
    }
  });

  it("config de um desfecho não vaza para o outro", () => {
    const metadata = { leadOutcomeDisqualified: config };
    expect(resolveAgentCrmMoveTarget(metadata, "lead_lost_interest")).toBeNull();
  });
});

describe("bloco de critérios no prompt", () => {
  const base = { nome: "Agente", systemPrompt: "Atenda bem." };
  const build = (agent: Record<string, unknown>) =>
    buildAgentSystemPrompt({
      agent: { ...base, ...agent } as never,
      languageInstruction: "Responda em português.",
    });

  it("sem automação ligada, PROÍBE o desfecho explicitamente", () => {
    const prompt = build({});
    expect(prompt).toContain('leadOutcome.action deve ser sempre "none"');
    expect(prompt).not.toContain("Desfechos habilitados");
  });

  it("imprime os critérios do operador na íntegra", () => {
    const criterios = "Só atendemos maiores de 18 anos residentes em Goiânia.";
    const prompt = build({
      leadOutcomeDisqualified: { ativo: true, criterios, funnelId: "f", columnId: "c" },
    });
    expect(prompt).toContain(criterios);
    expect(prompt).toContain('"disqualified"');
    // A outra automação continua desligada e não aparece.
    expect(prompt).not.toContain('"lost_interest"');
  });

  it("automação ligada SEM critérios não habilita nada", () => {
    const prompt = build({
      leadOutcomeDisqualified: { ativo: true, criterios: "   ", funnelId: "f", columnId: "c" },
    });
    expect(prompt).toContain('leadOutcome.action deve ser sempre "none"');
  });

  it("instrui que adiamento não é desfecho e que a resposta ainda é enviada", () => {
    // As duas confusões mais caras: matar um lead que só pediu para chamar
    // depois, e cortar a conversa sem responder.
    const prompt = build({
      leadOutcomeLostInterest: { ativo: true, criterios: "recusa clara", funnelId: "f", columnId: "c" },
    });
    expect(prompt).toContain("Adiamento não é desfecho");
    expect(prompt).toContain("a sua mensagem ainda é enviada");
    expect(prompt).toContain("Na dúvida, use \"none\"");
  });
});

describe("contrato: onde e quando o descarte é aplicado", () => {
  const outcomeSource = source("lib/server/agent-lead-outcome.ts");

  it("pausa, registra evento e cancela os DOIS tipos de job", () => {
    // Sem cancelar o follow-up já agendado, o lead "descartado" continuaria
    // recebendo mensagem depois — o bug mais provável desta feature.
    const opSource = source("lib/server/conversation-operation.ts");
    expect(opSource).toContain("pauseConversationForLeadOutcome");
    expect(opSource).toContain("cancelPendingAgentResponseJobs");
    expect(opSource).toContain("cancelPendingFollowUpJobs");
  });

  it("é aplicado nos TRÊS caminhos de resposta", () => {
    for (const path of [
      "lib/server/evolution-agent-reply.ts",
      "lib/server/meta-agent-reply.ts",
      "app/api/webhooks/evolution/route.ts",
    ]) {
      expect(source(path)).toContain("applyAgentLeadOutcome");
    }
  });

  it("no caminho Meta, vem DEPOIS do envio da resposta", () => {
    // Encerrar antes de enviar deixaria o lead sem a última mensagem — parece
    // defeito para quem está do outro lado.
    const meta = source("lib/server/meta-agent-reply.ts");
    const send = meta.indexOf("await sendWhatsAppTextMessage(");
    const apply = meta.indexOf("await applyAgentLeadOutcome(");
    expect(send).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(send);
  });

  it("a retomada roda ANTES do portão de automação, no processamento de job", () => {
    // Compartilhado pelos dois transportes. Depois do portão, o job já teria
    // sido cancelado e o agente nunca veria a mensagem.
    const jobs = source("lib/server/agent-response-jobs.ts");
    const resume = jobs.indexOf("resumeAfterLeadOutcomeIfConfigured");
    const gate = jobs.indexOf("const eligible = await shouldScheduleAgentResponse");
    expect(resume).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(resume);
  });

  it("a retomada só destrava pausa do próprio descarte", () => {
    // Pausa de handoff ou do vendedor jamais pode ser desfeita por aqui.
    expect(outcomeSource).toContain("LEAD_OUTCOME_PAUSED_BY");
    expect(source("lib/server/conversation-operation.ts")).toContain(
      "if (state.pausedBy !== LEAD_OUTCOME_PAUSED_BY) return false;",
    );
  });

  it("nunca lança: o efeito é isolado da resposta ao lead", () => {
    expect(outcomeSource).toContain("catch (err)");
  });
});

describe("reabrir conversa arquivada não ressuscita o agente", () => {
  it("descarte conta como bloqueio estrutural", () => {
    expect(
      isStructuralAutomationBlock({
        humanPaused: true,
        pausedBy: "agent_lead_outcome",
        pausedReason: "disqualified",
      }),
    ).toBe(true);
  });

  it("pausa manual comum continua sendo limpável", () => {
    expect(
      isStructuralAutomationBlock({
        humanPaused: true,
        pausedBy: "human_manual",
        pausedReason: "manual_toggle",
      }),
    ).toBe(false);
  });
});
