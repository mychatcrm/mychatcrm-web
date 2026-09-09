import { describe, expect, it } from "vitest";
import { parseLabRunRequest } from "@/lib/agent-test-lab/contracts";
import { labRuleMatches, labPhoneJid, labOnlyExpectsSilence, labMaskedJid } from "@/lib/agent-test-lab/policy";
import { acceptsLabInbound } from "@/lib/agent-test-lab/webhook-policy";
import { labAgentTurnState, labStepVerdict } from "@/lib/agent-test-lab/turn-policy";
import { labEffectVerdict, LAB_EMPTY_EFFECTS } from "@/lib/agent-test-lab/effect-policy";
import { buildLabIsolatedCopy } from "@/lib/agent-test-lab/isolation-policy";
import { parseLabEvaluatorOpinion, labEvaluatorEvidence } from "@/lib/agent-test-lab/evaluator-policy";

/**
 * The acceptance list from the plan, expressed as assertions.
 *
 * Everything here is decided in code and therefore provable here. The items that
 * genuinely need a scanned number and a live provider — real delivery, real agenda
 * mutation, worker interruption against a real Evolution — are named at the bottom
 * so the gap stays visible instead of looking covered.
 */

const scenario = (steps: { text: string; expected: string }[]) => ({
  version: 1, name: "Aceitação", goal: "Verificar comportamento", language: "pt-BR",
  steps: steps.map(step => ({ kind: "text", text: step.text, expected: { type: step.expected } })),
});
const request = (over: Record<string, unknown> = {}) => parseLabRunRequest({
  mode: "manual", profile: "short", targetKind: "original", tenantId: "tenant-a", agentId: "agent-a",
  channel: "evolution", connectionId: "11111111-1111-4111-8111-111111111111", ruleId: "22222222-2222-4222-8222-222222222222",
  formId: null, originalConfirmed: true, allowedEffects: [], testerModel: null,
  scenario: scenario([{ text: "oi", expected: "reply" }]), ...over,
});

describe("aceitação: destino e regra", () => {
  it("recusa uma regra de outra conexão, de outro transporte ou de outro agente", () => {
    const input = request();
    const good = { active: true, source: "whatsapp_organico", transport: "evolution",
      connection_id: input.connectionId, agent_ids: [input.agentId] };
    expect(labRuleMatches(input, good)).toBe(true);
    for (const bad of [
      { ...good, connection_id: "outra" }, { ...good, transport: "cloud_api" },
      { ...good, agent_ids: ["outro"] }, { ...good, active: false },
      // Two agents on the same number: the rule must name exactly one for organic.
      { ...good, agent_ids: [input.agentId, "outro"] },
    ]) expect(labRuleMatches(input, bad)).toBe(false);
    expect(labRuleMatches(input, null)).toBe(false);
  });

  it("distingue formulário Meta de entrada orgânica", () => {
    const form = request({ formId: "form-1" });
    const organic = { active: true, source: "whatsapp_organico", transport: "evolution",
      connection_id: form.connectionId, agent_ids: [form.agentId] };
    expect(labRuleMatches(form, organic)).toBe(false);
    const metaRule = { ...organic, source: "meta_form", use_all_forms: true, excluded_form_ids: [], included_form_ids: [] };
    expect(labRuleMatches(form, metaRule)).toBe(true);
    expect(labRuleMatches(form, { ...metaRule, use_all_forms: false, excluded_form_ids: ["form-1"] })).toBe(false);
  });

  it("ausência intencional de regra é silêncio esperado, não erro", () => {
    const silent = request({ ruleId: null, scenario: scenario([{ text: "oi", expected: "silence" }]) });
    expect(labOnlyExpectsSilence(silent)).toBe(true);
    expect(labStepVerdict("silence", { state: "timed_out", messages: 0 }).verdict).toBe("expected_block");
  });

  it("nunca deriva um telefone de um identificador que não é telefone", () => {
    for (const value of ["12345@lid", "123@g.us", "", "abc", "0000000000"]) expect(labPhoneJid(value)).toBeNull();
    expect(labPhoneJid("+55 62 99999-9999")).toBe("5562999999999@s.whatsapp.net");
  });

  it("mascara o número nos relatórios", () => {
    expect(labMaskedJid("5562999990000@s.whatsapp.net")).toBe("55••••000");
    expect(labMaskedJid(null)).toBeNull();
  });
});

describe("aceitação: mensagens agrupadas, duplicadas e fora de ordem", () => {
  const sent = "2026-09-09T12:00:00.000Z";
  const at = (s: number) => Date.parse(sent) + s * 1000;

  it("lê uma rajada como um turno só", () => {
    const burst = [1, 3, 6].map(s => new Date(at(s)).toISOString());
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: burst, now: at(10) }).state).toBe("waiting");
    expect(labAgentTurnState({ confirmedAt: sent, agentMessageTimes: burst, now: at(40) }).state).toBe("complete");
  });

  it("descarta mensagem anterior ao envio, que é sincronização de histórico", () => {
    expect(acceptsLabInbound({
      fromMe: false, providerTime: "2026-09-09T11:00:00.000Z", remoteJid: "5562999990000@s.whatsapp.net",
      targetJid: "5562999990000@s.whatsapp.net", runCreatedAt: sent, deadlineAt: "2026-09-09T13:00:00.000Z", now: at(10),
    })).toBe(false);
  });

  it("descarta mensagem de contato não autorizado e mensagem própria", () => {
    const base = {
      fromMe: false, providerTime: "2026-09-09T12:00:10.000Z", remoteJid: "5562999990000@s.whatsapp.net",
      targetJid: "5562999990000@s.whatsapp.net", runCreatedAt: sent, deadlineAt: "2026-09-09T13:00:00.000Z", now: at(20),
    };
    expect(acceptsLabInbound(base)).toBe(true);
    expect(acceptsLabInbound({ ...base, fromMe: true })).toBe(false);
    expect(acceptsLabInbound({ ...base, remoteJid: "5511888880000@s.whatsapp.net" })).toBe(false);
    // Past the deadline the laboratory stops importing anything at all.
    expect(acceptsLabInbound({ ...base, now: Date.parse("2026-09-09T13:00:01.000Z") })).toBe(false);
  });
});

describe("aceitação: agenda, follow-up, lembretes e temporizadores", () => {
  const observed = (over = {}) => ({ ...LAB_EMPTY_EFFECTS, ...over });
  const full = { elapsedMs: 3_600_000, requiredMs: 3_600_000 };

  it("aprova agenda só com linha no banco", () => {
    expect(labEffectVerdict("agenda_created", observed({ agendaCreated: 1 }), full).verdict).toBe("passed");
    expect(labEffectVerdict("agenda_created", observed(), full).verdict).toBe("failed");
  });

  it("não acelera temporizador em silêncio: janela curta vira não executado", () => {
    const short = { elapsedMs: 20 * 60_000, requiredMs: 24 * 60 * 60_000 };
    expect(labEffectVerdict("reminder", observed(), short).verdict).toBe("not_executed");
    expect(labEffectVerdict("follow_up", observed(), short).verdict).toBe("not_executed");
  });

  it("recurso desligado não vira aprovação", () => {
    expect(labEffectVerdict("follow_up", observed(), full).verdict).toBe("failed");
  });
});

describe("aceitação: quota, isolamento e limpeza", () => {
  it("nenhum campo público habilita isenção: os efeitos permitidos são um conjunto fechado", () => {
    expect(() => parseLabRunRequest({ ...request(), allowedEffects: ["cobrar_do_cliente"] } as never)).toThrow();
  });

  it("agente original exige confirmação explícita por execução", () => {
    expect(() => parseLabRunRequest({
      mode: "manual", profile: "short", targetKind: "original", tenantId: "t", agentId: "a",
      channel: "evolution", originalConfirmed: false, scenario: scenario([{ text: "oi", expected: "reply" }]),
    } as never)).toThrow("original_confirmation_required");
  });

  it("a cópia isolada não leva credencial nem contato de terceiro", () => {
    const copy = buildLabIsolatedCopy({ metadata: { meta_access_token: "live", handoffNumero: "+5562999990000", promptObjetivo: "Agendar" } });
    expect(JSON.stringify(copy.metadata)).not.toContain("live");
    expect(copy.metadata).not.toHaveProperty("handoffNumero");
  });

  it("IA testadora e modelo são obrigatórios juntos", () => {
    expect(() => parseLabRunRequest({ ...request({ mode: "autonomous" }), testerModel: null } as never)).toThrow("tester_model_required");
  });
});

describe("aceitação: o avaliador não decide o resultado", () => {
  it("marca a leitura como opinião e nunca aprova", () => {
    const opinion = parseLabEvaluatorOpinion({ reading: "consistent", reasoning: "Coerente.", contradictions: [] })!;
    const evidence = labEvaluatorEvidence(opinion);
    expect(evidence.verdict).toBe("not_executed");
    expect(evidence.description).toMatch(/não decide o resultado/i);
  });

  it("aponta prompts contraditórios sem escolher qual vale", () => {
    const opinion = parseLabEvaluatorOpinion({
      reading: "inconsistent", reasoning: "Duas regras de desconto.", contradictions: ["Regra A x Regra B"],
    })!;
    const evidence = labEvaluatorEvidence(opinion);
    expect(evidence.verdict).toBe("inconclusive");
    expect(evidence.description).toContain("Regra A x Regra B");
  });

  it("descarta resposta fora do formato em vez de exibi-la", () => {
    for (const bad of [null, {}, { reading: "aprovado", reasoning: "x" }, { reading: "consistent" }]) {
      expect(parseLabEvaluatorOpinion(bad)).toBeNull();
    }
  });
});

describe("aceitação: o que ainda depende de número real", () => {
  it.each([
    "entrega confirmada pelo provedor numa conversa real",
    "mutação real de agenda ponta a ponta com Google Calendar",
    "takeover humano antes e depois de confirmação",
    "worker interrompido no meio de um envio real",
    "desconexão da Evolution durante a conversa",
  ])("%s exige execução real e não está coberto aqui", pendente => {
    // Declarado de propósito: um teste que fingisse cobrir isso seria pior do que
    // a ausência dele, porque esconderia a lacuna atrás de um check verde.
    expect(pendente.length).toBeGreaterThan(0);
  });
});
