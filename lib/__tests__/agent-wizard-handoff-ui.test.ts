import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPromptFromBusiness, defaultWizardDraft } from "@/lib/agents/wizard-model";

describe("agent wizard handoff simplification", () => {
  it("keeps handoff disabled until the operator configures it", () => {
    expect(defaultWizardDraft.ctaHandoffAtivo).toBe(false);
    expect(defaultWizardDraft.handoffNumero).toBe("");
    expect(defaultWizardDraft.handoffMensagem).toBe("");
    expect(defaultWizardDraft.handoffKeywords).toEqual([]);
  });

  it("keeps agenda mutations disabled by default for new agents", () => {
    expect(defaultWizardDraft.agendaAutomationEnabled).toBe(false);
  });

  it("keeps hidden CTA out of the generated business prompt", () => {
    const prompt = createPromptFromBusiness("Atenda com atenção.", defaultWizardDraft);
    expect(prompt).toContain("seguir as instruções específicas escritas pelo gestor");
    expect(prompt).not.toContain("Conduzir para CTA final");
  });

  it("renders the complete handoff configuration without the legacy CTA field", () => {
    const source = readFileSync(
      join(process.cwd(), "components/dashboard/agentes/WizardStep4Fluxo.tsx"),
      "utf8",
    );
    expect(source).toContain("Número do atendente responsável");
    expect(source).toContain("Ativar transferência para humano");
    expect(source).toContain("disabled={!draft.ctaHandoffAtivo}");
    expect(source).toContain("Mensagem enviada ao cliente");
    expect(source).toContain("Palavras ou frases que pedem atendimento humano");
    expect(source).not.toContain("Objetivo Final do Agente (CTA)");
  });

  it("renders an independent agenda automation toggle", () => {
    const source = readFileSync(
      join(process.cwd(), "components/dashboard/agentes/WizardStepAgendaAutomation.tsx"),
      "utf8",
    );
    expect(source).toContain("agendaAutomationEnabled");
    expect(source).toContain("Permitir criar, remarcar e cancelar agendamentos");
  });
});
