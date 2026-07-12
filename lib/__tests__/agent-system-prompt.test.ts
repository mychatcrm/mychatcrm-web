import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/lib/ai/agent-system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("puts the language instruction first and includes operational agent settings", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "CRITICAL INSTRUCTION - LANGUAGE: The user's message is in English.",
      agent: {
        nome: "Max Vendas",
        objetivo: "vender",
        tom: "Consultivo",
        delayResposta: 2,
        idioma: "Automático",
        promptIdentidade: "Sou consultor virtual.",
        promptObjetivo: "Qualificar e vender.",
        systemPrompt: "Faça perguntas curtas.",
        promptRegrasAdicionais: "Não prometa desconto.",
        respostasProibidas: "Não fale de concorrentes.",
        responseMode: "audio",
        followUpInteligente: { ativo: true, tentativasContato: 2, intervaloVerificacaoMinutos: 60 },
        crmAutoMoveEnabled: true,
        crmTargetFunnelId: "funil-default",
        crmTargetStatus: "contato",
      },
      runtimeContext: {
        state: null,
        lead: {
          id: "lead-1",
          name: "Maria",
          phone: "5511999990000",
          source: "whatsapp",
          status: "contato",
          crmFunnelId: "funil-default",
          notes: null,
          agentId: "ag-vendas",
          aiSummary: "Quer contratar.",
          leadTemperature: "quente",
          suggestedNextAction: "Chamar humano.",
          profileMetadata: {},
        },
        summary: null,
        recentMessages: [],
        knowledgeSnippets: ["Material: FAQ\nTrecho extraído:\nUse o plano Pro."],
        outboundMediaLines: [],
      },
    });

    expect(prompt.startsWith("CRITICAL INSTRUCTION - LANGUAGE")).toBe(true);
    expect(prompt).toContain("REGRA UNIVERSAL DE CONTEXTO");
    expect(prompt).toContain("não misture informações de outras campanhas");
    expect(prompt).toContain("ESCOPO SOBERANO DO AGENTE");
    expect(prompt).toContain("são a única fonte de verdade sobre o que este agente atende");
    expect(prompt).not.toMatch(/Minha Casa Minha Vida|casa ou apartamento|nome do empreendimento/i);
    expect(prompt).toContain(
      "Ao confirmar um agendamento, sempre repita a data, horário e local na sua resposta de confirmação.",
    );
    expect(prompt).toContain("[CONTEXTO DO SISTEMA: Data e hora atual:");
    expect(prompt).toMatch(
      /\[CONTEXTO DO SISTEMA: Data e hora atual: .+, \d{2} de .+ de \d{4}, \d{2}:\d{2} \(.+\)\. Use SEMPRE esta data\/hora como referência para qualquer cálculo de data/,
    );
    expect(prompt.indexOf("[CONTEXTO DO SISTEMA")).toBeGreaterThan(prompt.indexOf("IDENTIDADE DO AGENTE"));
    expect(prompt).toContain("Max Vendas");
    expect(prompt).toContain("Tom de voz: Consultivo");
    expect(prompt).toContain("Não fale de concorrentes.");
    expect(prompt).toContain("Modo de resposta configurado: audio");
    expect(prompt).toContain("Destino CRM automático: ativo");
    expect(prompt).toContain("Dados do lead:");
    expect(prompt).toContain("Material: FAQ");
    expect(prompt).toContain("vídeo");
  });

  it("uses simplePrompt as the main instruction block in simple mode", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Assistente",
        objetivo: "vender",
        instructionMode: "simple",
        simplePrompt: "Você vende planos Pro com tom consultivo.",
        systemPrompt: "instruções pro legadas",
        promptIdentidade: "identidade pro legada",
      },
    });

    expect(prompt).toContain("PROMPT DO AGENTE\nVocê vende planos Pro com tom consultivo.");
    expect(prompt).not.toContain("IDENTIDADE CONFIGURADA");
    expect(prompt).not.toContain("instruções pro legadas");
  });

  it("includes an imperative outbound media block when ready files exist", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        objetivo: "vender",
        systemPrompt: "Ajude o cliente.",
      },
      runtimeContext: {
        state: null,
        lead: null,
        summary: null,
        recentMessages: [],
        knowledgeSnippets: [],
        outboundMediaLines: ["fachada.jpg — Foto da fachada"],
      },
    });

    expect(prompt).toContain("CAPACIDADE DO SISTEMA — ENVIO DE ARQUIVOS VIA WHATSAPP");
    expect(prompt).toContain("Arquivos disponíveis para envio nesta conversa:");
    expect(prompt).toContain("fachada.jpg");
    expect(prompt).toContain("[[ENVIAR_MEDIA:nome_arquivo]]");
    expect(prompt).toContain("UMA única mensagem curta e genérica");
    expect(prompt).toContain("CORRETO:");
    expect(prompt).toContain("[[ENVIAR_MEDIA:arquivo1.jpg]]");
    expect(prompt).toContain("[[ENVIAR_MEDIA:arquivo2.jpg]]");
    expect(prompt).toContain("[[ENVIAR_MEDIA:arquivo3.pdf]]");
    expect(prompt).toContain("ERRADO:");
    expect(prompt).toContain("Nunca reenvie arquivos já enviados nesta conversa");
    expect(prompt).toContain("handoff e encaminhamento para humano se aplicam APENAS para atendimento");
  });

  it("uses a simple mandatory handoff marker instruction", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        objetivo: "vender",
        ctaHandoffAtivo: true,
        systemPrompt: "Ajude o cliente.",
      },
    });

    expect(prompt).toContain("Quando o cliente quiser falar com uma pessoa real");
    expect(prompt).toContain("inclua [[HANDOFF]] no final da resposta. Nada mais.");
    expect(prompt).not.toContain("Mesmo que você precise enviar arquivos na mesma resposta");
  });

  it("forbids handoff marker when human transfer is disabled", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        ctaHandoffAtivo: false,
        systemPrompt: "Ajude o cliente.",
      },
    });

    expect(prompt).toContain("Nunca inclua [[HANDOFF]]");
    expect(prompt).toContain("não há atendimento humano disponível no momento");
  });

  it("instructs the model to use structured agenda directives", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled: true },
    });

    expect(prompt).toContain("[[AGENDAR: data=DD/MM/AAAA, hora=HH:MM");
    expect(prompt).toContain("[[CANCELAR_AGENDA]]");
  });

  it("forbids human delegation in agenda flow when handoff is disabled", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Bia",
        systemPrompt: "Ajude o cliente.",
        agendaAutomationEnabled: true,
        ctaHandoffAtivo: false,
      },
    });

    expect(prompt).toContain("Transferência humana está DESATIVADA");
    expect(prompt).toContain("Nunca diga que atendente, humano, equipe");
    expect(prompt).toContain("[[AGENDAR: data=DD/MM/AAAA, hora=HH:MM");
  });

  it("keeps agenda read-only when agenda automation is disabled", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled: false },
    });

    expect(prompt).toContain("automação de agenda está desativada");
    expect(prompt).toContain("nunca inclua [[AGENDAR: ...]]");
  });

  it("injects Meta Lead Ads form memory so the agent does not re-ask", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Agente",
        objetivo: "vender",
        systemPrompt: "Atenda leads.",
      },
      runtimeContext: {
        state: null,
        lead: {
          id: "lead-1",
          name: "Renato",
          phone: "5562993580574",
          source: "lead_ads",
          status: "contato",
          crmFunnelId: null,
          notes: null,
          agentId: "ag-1",
          aiSummary: null,
          leadTemperature: null,
          suggestedNextAction: null,
          profileMetadata: {
            source: "lead_ads",
            form_fields: [{ key: "renda", label: "Renda bruta", value: "R$ 8.000" }],
          },
        },
        summary: null,
        recentMessages: [],
        knowledgeSnippets: [],
        outboundMediaLines: [],
      },
    });

    expect(prompt).toContain("DADOS JÁ INFORMADOS PELO LEAD NO FORMULÁRIO META");
    expect(prompt).toContain("Renda bruta: R$ 8.000");
    expect(prompt).toContain("NUNCA pergunte de novo");
  });
});
