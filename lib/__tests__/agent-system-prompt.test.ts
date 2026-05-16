import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/lib/ai/agent-system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("puts the language instruction first and includes operational agent settings", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "CRITICAL INSTRUCTION - LANGUAGE: The user's message is in English.",
      agent: {
        nome: "Max Vendas",
        genero: "masculino",
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
    expect(prompt).toContain("UM [[ENVIAR_MEDIA:...]] para CADA arquivo");
    expect(prompt).toContain("[[ENVIAR_MEDIA:spa.jpg]]");
    expect(prompt).toContain("handoff e encaminhamento para humano se aplicam APENAS para atendimento");
  });
});
