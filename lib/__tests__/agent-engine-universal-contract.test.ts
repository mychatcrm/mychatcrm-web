import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENDA_DATETIME_NEEDED_REPLY,
  AGENDA_FAILURE_REPLY,
  AGENDA_INVALID_TIME_REPLY,
  AGENDA_PAST_DATETIME_REPLY,
  AGENDA_SLOT_TAKEN_REPLY,
  AGENDA_SUCCESS_REPLY_CANCELLED,
  AGENDA_SUCCESS_REPLY_SCHEDULED,
  localizeAgendaReply,
} from "@/lib/server/agent-cta-scheduler";
import { resolveConfiguredLanguageCode, type SupportedLanguageCode } from "@/lib/ai/language-detect";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("item 3 — respostas fixas de agenda seguem o idioma da conversa", () => {
  const FIXAS = [
    AGENDA_FAILURE_REPLY,
    AGENDA_SUCCESS_REPLY_SCHEDULED,
    AGENDA_SUCCESS_REPLY_CANCELLED,
    AGENDA_SLOT_TAKEN_REPLY,
    AGENDA_DATETIME_NEEDED_REPLY,
    AGENDA_PAST_DATETIME_REPLY,
    AGENDA_INVALID_TIME_REPLY,
  ];
  const IDIOMAS: SupportedLanguageCode[] = ["en", "es", "fr", "de", "it"];

  it("toda resposta fixa tem tradução em todos os idiomas suportados", () => {
    for (const pt of FIXAS) {
      for (const lang of IDIOMAS) {
        const traduzido = localizeAgendaReply(pt, lang);
        expect(traduzido, `faltou tradução (${lang}) para: ${pt.slice(0, 40)}…`).not.toBe(pt);
        expect(traduzido.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("pt e ausência de idioma devolvem o texto original", () => {
    expect(localizeAgendaReply(AGENDA_FAILURE_REPLY, "pt")).toBe(AGENDA_FAILURE_REPLY);
    expect(localizeAgendaReply(AGENDA_FAILURE_REPLY, null)).toBe(AGENDA_FAILURE_REPLY);
    expect(localizeAgendaReply(AGENDA_FAILURE_REPLY, undefined)).toBe(AGENDA_FAILURE_REPLY);
  });

  it("texto que não é resposta fixa do sistema passa intacto", () => {
    // Prosa do modelo já vem no idioma certo — traduzir por engano corromperia
    // a resposta que o cliente configurou.
    const prosa = "Perfeito! Posso confirmar para 20/07 às 14h?";
    expect(localizeAgendaReply(prosa, "en")).toBe(prosa);
  });
});

describe("item 3 — idioma efetivo respeita o que o agente configurou", () => {
  it("idioma fixo do agente vence o texto do cliente", () => {
    expect(resolveConfiguredLanguageCode("Inglês", "olá, tudo bem?")).toBe("en");
    expect(resolveConfiguredLanguageCode("Espanhol", "olá, tudo bem?")).toBe("es");
    expect(resolveConfiguredLanguageCode("Português BR", "hello there")).toBe("pt");
  });

  it("automático/vazio detecta do texto do cliente", () => {
    expect(resolveConfiguredLanguageCode("Automático", "hello, how are you?")).toBe("en");
    expect(resolveConfiguredLanguageCode(null, "olá, tudo bem?")).toBe("pt");
  });
});

describe("contrato: a engine do agente é universal (trava para o futuro)", () => {
  // Cada cliente configura o próprio nicho. Nada específico de um segmento pode
  // ser hardcoded na camada que o sistema injeta em TODOS os agentes.
  const ARQUIVOS_DA_ENGINE = [
    "lib/ai/agent-system-prompt.ts",
    "lib/server/follow-up-engine.ts",
    "lib/server/agent-cta-scheduler.ts",
  ];

  it("nenhum arquivo da engine cita um nicho ou cliente específico", () => {
    const NICHO_OU_CLIENTE =
      /\b(imobili[áa]ri|corretor|im[óo]vel|apartamento|broker\s*office|cl[íi]nica|dentista|consult[óo]rio m[ée]dic|advocaci|concession[áa]ri|test[- ]drive)\b/i;

    for (const path of ARQUIVOS_DA_ENGINE) {
      const content = source(path);
      const hit = content.match(NICHO_OU_CLIENTE);
      expect(hit?.[0], `${path} citou nicho/cliente específico: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("o follow-up não presume que todo agente vende algo", () => {
    const content = source("lib/server/follow-up-engine.ts");
    // Frases reais que quebravam agentes fora do funil comercial, montadas em
    // pedaços para o próprio teste não virar a ocorrência que ele proíbe.
    expect(content).not.toContain(["avaliando", "concorrentes"].join(" "));
    expect(content).not.toContain(["Recupere", "a", "oportunidade"].join(" "));
  });

  it("o prompt não manda confirmar com a equipe sem transferência humana ativa", () => {
    const content = source("lib/ai/agent-system-prompt.ts");
    const regra = content.indexOf("diga que vai confirmar com a equipe");
    expect(regra).toBeGreaterThan(0);
    // A regra precisa estar dentro de um ramo condicional de ctaHandoffAtivo.
    const trecho = content.slice(Math.max(0, regra - 400), regra);
    expect(trecho).toContain("ctaHandoffAtivo");
  });

  it("a impersonação humana está atrás do toggle, não do campo de velocidade", () => {
    const content = source("lib/ai/agent-system-prompt.ts");
    const frase = content.indexOf("Nunca demonstre que é uma IA");
    expect(frase).toBeGreaterThan(0);
    const trecho = content.slice(Math.max(0, frase - 300), frase);
    expect(trecho).toContain("useHumanPersona");
  });
});
