/**
 * Diff do CRM.
 *
 * A regra que mais importa: sugestão que SUBSTITUI um valor existente nasce
 * desmarcada. Sobrescrever o que uma pessoa digitou é bem mais grave que deixar
 * de preencher um campo vazio, e o padrão da interface tem que refletir isso.
 */
import { describe, expect, it } from "vitest";
import { buildCrmSuggestions } from "@/lib/server/meeting-crm-suggestions";

const EMPTY_LEAD = { notes: null, lead_temperature: null, profile_metadata: {} };

describe("buildCrmSuggestions", () => {
  it("propõe preencher campo vazio, já marcado", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { orcamentoMencionado: "R$ 800.000" },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      field: "metadata.orcamento",
      currentValue: null,
      suggestedValue: "R$ 800.000",
      kind: "fill",
      defaultChecked: true,
    });
  });

  it("propõe substituição DESMARCADA quando já existe valor", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { orcamentoMencionado: "R$ 800.000" },
      summaryShort: "",
      lead: { ...EMPTY_LEAD, profile_metadata: { orcamento: "R$ 500.000" } },
    });

    expect(suggestions[0]).toMatchObject({
      kind: "replace",
      currentValue: "R$ 500.000",
      defaultChecked: false,
    });
  });

  it("não sugere nada quando o valor já é o mesmo", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { orcamentoMencionado: "R$ 800.000" },
      summaryShort: "",
      lead: { ...EMPTY_LEAD, profile_metadata: { orcamento: "R$ 800.000" } },
    });
    expect(suggestions).toHaveLength(0);
  });

  it("achata listas de texto e de objetos no mesmo formato", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: {
        dores: ["Demora no atendimento", "Preço alto"],
        objecoes: [{ texto: "Achou caro", atMs: 1000 }],
      },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });

    const dores = suggestions.find((item) => item.field === "metadata.dores");
    const objecoes = suggestions.find((item) => item.field === "metadata.objecoes");
    expect(dores?.suggestedValue).toBe("Demora no atendimento; Preço alto");
    expect(objecoes?.suggestedValue).toBe("Achou caro");
  });

  it("ignora campos ausentes, nulos e listas vazias", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { orcamentoMencionado: null, dores: [], decisor: "   " },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });
    expect(suggestions).toHaveLength(0);
  });

  it("deriva temperatura da intenção declarada", () => {
    const quente = buildCrmSuggestions({
      templateFields: { intencaoCompra: "alta" },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });
    expect(quente[0]).toMatchObject({
      field: "lead_temperature",
      suggestedValue: "quente",
      defaultChecked: true,
    });

    // "indefinida" não vira temperatura: sem sinal, não se inventa um.
    const indefinida = buildCrmSuggestions({
      templateFields: { intencaoCompra: "indefinida" },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });
    expect(indefinida).toHaveLength(0);
  });

  it("não repropõe temperatura já igual", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { intencaoCompra: "alta" },
      summaryShort: "",
      lead: { ...EMPTY_LEAD, lead_temperature: "quente" },
    });
    expect(suggestions).toHaveLength(0);
  });

  it("sobrevive a templateFields corrompido", () => {
    expect(() =>
      buildCrmSuggestions({
        templateFields: { dores: "não é lista", orcamentoMencionado: { objeto: true } } as never,
        summaryShort: "",
        lead: { ...EMPTY_LEAD, profile_metadata: "não é objeto" },
      }),
    ).not.toThrow();
  });

  it("trunca valor muito longo em vez de gravar texto sem limite no lead", () => {
    const suggestions = buildCrmSuggestions({
      templateFields: { decisor: "x".repeat(2000) },
      summaryShort: "",
      lead: EMPTY_LEAD,
    });
    expect(suggestions[0]!.suggestedValue.length).toBeLessThanOrEqual(500);
  });
});
