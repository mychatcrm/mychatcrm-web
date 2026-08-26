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
          name: "Example Lead",
          phone: "15555550123",
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
    expect(prompt).toContain("[SYSTEM CONTEXT: Current date and time:");
    expect(prompt).toMatch(
      /\[SYSTEM CONTEXT: Current date and time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)\. Use this timestamp only as the temporal reference for date calculations\.\]/,
    );
    expect(prompt.indexOf("[SYSTEM CONTEXT")).toBeGreaterThan(prompt.indexOf("IDENTIDADE DO AGENTE"));
    expect(prompt).toContain("Max Vendas");
    expect(prompt).toContain("Tom configurado: Consultivo");
    expect(prompt).toContain("Não fale de concorrentes.");
    expect(prompt).not.toContain("Dados do lead:");
    expect(prompt).not.toContain("Material: FAQ");
    expect(prompt).toContain("mídia sem transcrição");
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
    expect(prompt).not.toContain("Nunca demonstre que é uma IA");
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

    expect(prompt).toContain("CAPACIDADE TÉCNICA — ENVIO DE ARQUIVOS");
    expect(prompt).toContain("catálogo de arquivos aparecerá em uma mensagem separada");
    expect(prompt).not.toContain("fachada.jpg");
    expect(prompt).toContain("media.filenames");
    expect(prompt).not.toContain("[[ENVIAR_MEDIA:");
    expect(prompt).toContain("Nunca crie, altere ou adivinhe nomes de arquivo");
  });

  it("uses the structured handoff contract", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        objetivo: "vender",
        ctaHandoffAtivo: true,
        handoffMensagem: "Vou encaminhar conforme solicitado.",
        handoffNumero: "15555550124",
        handoffKeywords: ["transfer-code-42"],
        systemPrompt: "Ajude o cliente.",
      },
    });

    expect(prompt).toContain("Somente quando um critério configurado for atendido");
    expect(prompt).toContain("transfer-code-42");
    expect(prompt).toContain("handoff.requested=true");
    expect(prompt).not.toContain("[[HANDOFF]]");
    expect(prompt).not.toMatch(/atendente|especialista|vendedor|gerente/i);
  });

  it("keeps structured handoff disabled when human transfer is disabled", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Max Vendas",
        ctaHandoffAtivo: false,
        systemPrompt: "Ajude o cliente.",
      },
    });

    expect(prompt).toContain("handoff.requested deve ser false");
    expect(prompt).not.toContain("[[HANDOFF]]");
    // Handoff desligado nunca pode virar recusa de atendimento: o agente
    // continua conduzindo a conversa normalmente.
    expect(prompt).toContain("o atendimento válido continua normalmente");
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
    expect(prompt).toContain("não autoriza afirmar nada fora das instruções configuradas");
    expect(prompt).toContain("fazem parte do escopo técnico autorizado");
    expect(prompt).toContain("CAPACIDADE OPERACIONAL DO SISTEMA: agendar, remarcar e cancelar compromissos");
    expect(prompt).toContain("ESCOPO SOBERANO DO AGENTE");
    expect(prompt).toContain("REGRA UNIVERSAL DE CONTEXTO");
  });

  describe("unbounded scheduling window", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("injects only the configured weekday/time rules without a hidden date horizon", () => {
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

      expect(prompt).toContain("dias ISO da semana 1, 2, 3, 4, 5");
      expect(prompt).toContain("das 09:00 às 15:05");
      expect(prompt).toContain("Não imponha horizonte máximo");
      expect(prompt).not.toContain("CALENDÁRIO REAL");
      expect(prompt).not.toContain("DATAS VÁLIDAS MAIS PRÓXIMAS");
    });

    it("does not inject a fabricated finite calendar when the window is off", () => {
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

      expect(prompt).not.toContain("CALENDÁRIO REAL");
      expect(prompt).not.toContain("DATAS VÁLIDAS MAIS PRÓXIMAS");
    });

    it("keeps weekday/date accuracy without restricting the agent to six generated dates", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-12T12:00:00-03:00"));
      const prompt = buildAgentSystemPrompt({
        languageInstruction: "Responda em português.",
        agent: {
          nome: "Recrutamento",
          systemPrompt: "Ajude o cliente.",
          agendaAutomationEnabled: true,
          timezone: "America/Sao_Paulo",
          agendaDisponibilidade: {
            ativo: true,
            diasSemana: [1, 2, 3, 4, 5],
            horaInicio: "09:00",
            horaFim: "18:00",
          },
        },
      });

      expect(prompt).toContain("calcule ambos no fuso configurado");
      expect(prompt).toContain("cite somente a data completa");
      expect(prompt).not.toContain("Nunca ofereça dias fora desta lista");
      expect(prompt).not.toContain("slice(0, 6)");
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

  it("never injects Meta form answers into the system prompt", () => {
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
          name: "Example Lead",
          phone: "15555550125",
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
            form_fields: [{ key: "example_field", label: "Example field", value: "TEST_VALUE" }],
          },
        },
        summary: null,
        recentMessages: [],
        knowledgeSnippets: [],
        outboundMediaLines: [],
      },
    });

    expect(prompt).not.toContain("DADOS JÁ INFORMADOS PELO LEAD NO FORMULÁRIO META");
    expect(prompt).not.toContain("Example field: TEST_VALUE");
    expect(prompt).toContain("Formulários, materiais recuperados, histórico");
  });

  it("uses only the exact configured tone and never injects a hidden channel persona", () => {
    const prompt = buildAgentSystemPrompt({
      languageInstruction: "Responda em português.",
      agent: {
        nome: "Agente",
        tom: "casual",
        systemPrompt: "Ajude o cliente.",
        useSystemToneInstructions: true,
        useSystemWhatsappStyleGuide: true,
      },
    });

    expect(prompt).toContain("TOM CONFIGURADO PELO CLIENTE");
    expect(prompt).toContain("casual");
    expect(prompt).not.toContain("ESTILO WHATSAPP (OBRIGATÓRIO)");
    expect(prompt).not.toContain("Nunca demonstre que é uma IA");
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

    expect(prompt).not.toContain("TOM CONFIGURADO PELO CLIENTE");
    expect(prompt).not.toContain("ESTILO WHATSAPP (OBRIGATÓRIO)");
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

    expect(prompt).not.toContain("TOM CONFIGURADO PELO CLIENTE");
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

describe("engine universal — sem contradição e sem persona forçada", () => {
  function build(agentOverrides: Record<string, unknown>) {
    return buildAgentSystemPrompt({
      languageInstruction: "LANG",
      agent: {
        nome: "Agente",
        systemPrompt: "Atenda bem.",
        idioma: "Automático",
        ...agentOverrides,
      },
      runtimeContext: null,
    });
  }

  describe("item 1: handoff inválido não cria promessa nem critério implícito", () => {
    it("com toggle ativo mas configuração incompleta, mantém handoff desligado", () => {
      const prompt = build({ ctaHandoffAtivo: true });
      expect(prompt).toContain("TRANSFERÊNCIA DESATIVADA OU INCOMPLETA");
      expect(prompt).not.toContain("confirmar com a equipe");
    });

    it("com transferência humana DESLIGADA, nunca promete retorno de outra pessoa", () => {
      const prompt = build({ ctaHandoffAtivo: false });
      // Antes, o prompt mandava "confirmar com a equipe" ao mesmo tempo que
      // proibia dizer que alguém retornaria — o modelo obedecia ora um, ora outro.
      expect(prompt).not.toContain("confirmar com a equipe");
      expect(prompt).toContain("sem prometer contato ou ação de terceiros");
    });
  });

  describe("item 4: persona e ritmo não são inventados pelo runtime", () => {
    it("por padrão não finge ser humano", () => {
      const prompt = build({ delayResposta: 2 });
      expect(prompt).not.toContain("Nunca demonstre que é uma IA");
      expect(prompt).not.toContain("Você é um ser humano");
    });

    it("o campo legado não injeta impersonação", () => {
      const prompt = build({ delayResposta: 2, useHumanPersona: true });
      expect(prompt).not.toContain("Nunca demonstre que é uma IA");
      expect(prompt).not.toContain("Você é um ser humano");
    });

    it("velocidade permanece metadado técnico, não instrução comportamental", () => {
      const prompt = build({ delayResposta: 2, useHumanPersona: false });
      expect(prompt).not.toContain("Nunca demonstre que é uma IA");
      expect(prompt).not.toContain("Você é um ser humano");
      expect(prompt).toContain("Velocidade simulada: 2s");
      expect(prompt).not.toContain("COMPORTAMENTO:");
    });

    it("não transforma atraso maior em personalidade", () => {
      const prompt = build({ delayResposta: 10, useHumanPersona: false });
      expect(prompt).not.toContain("ser humano ocupado");
      expect(prompt).not.toContain("várias conversas ao mesmo tempo");
      expect(prompt).toContain("Velocidade simulada: 10s");
    });

    it("sem velocidade configurada, o toggle não injeta nada", () => {
      const prompt = build({ delayResposta: 0, useHumanPersona: false });
      expect(prompt).not.toContain("COMPORTAMENTO:");
    });
  });
});
