import { afterEach, describe, expect, it, vi } from "vitest";
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
        agendaAutomationEnabled: true,
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
    expect(prompt).toMatch(/não misture informações de outras campanhas/i);
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

  it("impede nova apresentação quando a conversa já está em andamento", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: { nome: "Assistente", tom: "Profissional", systemPrompt: "Ajude o cliente." },
      runtimeContext: {
        state: null,
        lead: null,
        summary: null,
        recentMessages: [
          { role: "assistant", content: "Você tem disponibilidade hoje?" },
          { role: "user", content: "Oi" },
        ],
        knowledgeSnippets: [],
        outboundMediaLines: [],
      },
    });
    expect(prompt).toContain("ATENDIMENTO JÁ INICIADO");
    expect(prompt).toContain("Nunca cumprimente novamente");
    expect(prompt).toContain("não um novo atendimento");
    expect(prompt).toContain("Nunca mostre AAAA-MM-DD");
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

  it("instructs the model to return a structured agenda plan", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled: true },
    });

    expect(prompt).toContain("PLANO ESTRUTURADO DA AGENDA");
    expect(prompt).toContain('agenda.action="none"');
    expect(prompt).toContain("Cancelamento é sempre bifásico");
    expect(prompt).toContain("use propose_cancel");
    expect(prompt).toContain("Use cancel somente quando");
    expect(prompt).not.toContain("[[AGENDAR:");
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
    expect(prompt).toContain("PLANO ESTRUTURADO DA AGENDA");
  });

  it("omits the entire AGENDA block when agenda automation is disabled", () => {
    for (const agendaAutomationEnabled of [false, undefined]) {
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled },
      });

      // A leitura de compromissos ("quero ver meus agendamentos") é detectada
      // direto no texto do cliente por código (clientRequestedAgendaList),
      // não depende deste texto do prompt — pode sumir sem quebrar a função.
      expect(prompt).not.toContain("AGENDA\n");
      expect(prompt).not.toContain("automação de agenda está desativada");
      expect(prompt).not.toContain('agenda.action="list"');
      expect(prompt).not.toContain("Não invente compromissos");
      expect(prompt).not.toContain(
        "Ao confirmar um agendamento, sempre repita a data, horário e local na sua resposta de confirmação.",
      );
    }
  });

  it("authorizes agenda as a system capability inside scope blocks when automation is on", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled: true },
    });

    expect(prompt).toContain("EXCEÇÃO — CAPACIDADES OPERACIONAIS DO SISTEMA");
    expect(prompt).toContain("NUNCA é sair do escopo");
    expect(prompt).toContain("não autoriza oferecer, recomendar ou afirmar nada fora das instruções configuradas");
    expect(prompt).toContain("fazem parte do escopo técnico autorizado");
    expect(prompt).toContain("CAPACIDADE OPERACIONAL DO SISTEMA: agendar, remarcar e cancelar compromissos");
    expect(prompt).toContain("ESCOPO SOBERANO DO AGENTE");
    expect(prompt).toContain("REGRA UNIVERSAL DE CONTEXTO");
  });

  describe("real calendar injection", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("injects the concrete calendar and the valid dates for the availability window", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-14T12:00:00-03:00"));
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: {
          nome: "Max Vendas",
          systemPrompt: "Ajude o cliente.",
          agendaAutomationEnabled: true,
          timezone: "America/Sao_Paulo",
          agendaDisponibilidade: {
            ativo: true,
            diasSemana: [1, 2, 3, 4, 5],
            horaInicio: "09:00",
            horaFim: "15:05",
          },
        },
      });

      expect(prompt).toContain("CALENDÁRIO REAL");
      expect(prompt).toContain("terça-feira 14/07/2026 (hoje)");
      expect(prompt).toContain("quarta-feira 15/07/2026 (amanhã)");
      expect(prompt).toContain("DATAS VÁLIDAS MAIS PRÓXIMAS");
      expect(prompt).toContain("sexta-feira 17/07/2026");
      expect(prompt).toContain("segunda-feira 20/07/2026");
      expect(prompt).toContain("das 09:00 às 15:05");
      const validLine = prompt.split("\n").find((l) => l.includes("DATAS VÁLIDAS")) ?? "";
      expect(validLine).not.toContain("sábado");
      expect(validLine).not.toContain("domingo");
    });

    it("injects the calendar without the valid-dates list when the window is off", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-14T12:00:00-03:00"));
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: {
          nome: "Max Vendas",
          systemPrompt: "Ajude o cliente.",
          agendaAutomationEnabled: true,
          timezone: "America/Sao_Paulo",
        },
      });

      expect(prompt).toContain("CALENDÁRIO REAL");
      expect(prompt).not.toContain("DATAS VÁLIDAS MAIS PRÓXIMAS");
    });
  });

  it("omits the agenda scope carve-out when automation is off", () => {
    for (const agendaAutomationEnabled of [false, undefined]) {
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: { nome: "Max Vendas", systemPrompt: "Ajude o cliente.", agendaAutomationEnabled },
      });

      expect(prompt).not.toContain("EXCEÇÃO — CAPACIDADES OPERACIONAIS DO SISTEMA");
      expect(prompt).not.toContain("CAPACIDADE OPERACIONAL DO SISTEMA: agendar");
      expect(prompt).toContain("ESCOPO SOBERANO DO AGENTE");
    }
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

  it("keeps the system tone and WhatsApp style blocks when the toggles are undefined or true", () => {
    for (const agentOverrides of [
      {},
      { useSystemToneInstructions: true, useSystemWhatsappStyleGuide: true },
    ]) {
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: { nome: "Max Vendas", tom: "casual", systemPrompt: "Ajude o cliente.", ...agentOverrides },
      });

      expect(prompt).toContain("INSTRUÇÕES OBRIGATÓRIAS DE COMPORTAMENTO");
      expect(prompt).toContain("ESTILO WHATSAPP (OBRIGATÓRIO)");
    }
  });

  it("drops the system tone instructions when useSystemToneInstructions is false", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        tom: "casual",
        systemPrompt: "Ajude o cliente.",
        useSystemToneInstructions: false,
      },
    });

    expect(prompt).not.toContain("INSTRUÇÕES OBRIGATÓRIAS DE COMPORTAMENTO");
    expect(prompt).toContain("ESTILO WHATSAPP (OBRIGATÓRIO)");
  });

  it("drops the WhatsApp style guide when useSystemWhatsappStyleGuide is false", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        tom: "casual",
        systemPrompt: "Ajude o cliente.",
        useSystemWhatsappStyleGuide: false,
      },
    });

    expect(prompt).toContain("INSTRUÇÕES OBRIGATÓRIAS DE COMPORTAMENTO");
    expect(prompt).not.toContain("ESTILO WHATSAPP (OBRIGATÓRIO)");
  });

  it("never includes the removed advanced-config noise block, regardless of toggles", () => {
    for (const agentOverrides of [
      {},
      { useSystemToneInstructions: false, useSystemWhatsappStyleGuide: false },
    ]) {
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: {
          nome: "Max Vendas",
          systemPrompt: "Ajude o cliente.",
          responseMode: "audio",
          crmAutoMoveEnabled: true,
          crmTargetFunnelId: "funil-default",
          crmTargetStatus: "contato",
          ...agentOverrides,
        },
      });

      expect(prompt).not.toContain("CONFIGURAÇÕES AVANÇADAS DO AGENTE");
      expect(prompt).not.toContain("Modo de resposta configurado");
      expect(prompt).not.toContain("Destino CRM automático");
      expect(prompt).not.toContain("Origens/ativação");
      expect(prompt).not.toContain("Comando de pausa humana");
    }
  });
});
