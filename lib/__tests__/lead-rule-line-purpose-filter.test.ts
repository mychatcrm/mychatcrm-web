import { describe, expect, it } from "vitest";
import {
  filterConnectionsForRuleSource,
  isConnectionPurposeMismatch,
  requiredPurposeForSource,
} from "@/lib/lead-rule-line-purpose-filter";

const livre = { id: "linha-livre", purpose: null } as const;
const formsLine = { id: "linha-forms", purpose: "forms" } as const;
const directLine = { id: "linha-direct", purpose: "direct" } as const;
const todas = [livre, formsLine, directLine];

describe("requiredPurposeForSource", () => {
  it("mapeia origem para finalidade exigida", () => {
    expect(requiredPurposeForSource("meta_form")).toBe("forms");
    expect(requiredPurposeForSource("whatsapp_organico")).toBe("direct");
  });

  it("origens sem finalidade própria não exigem nada", () => {
    expect(requiredPurposeForSource("whatsapp_api")).toBeNull();
    expect(requiredPurposeForSource("")).toBeNull();
    expect(requiredPurposeForSource(undefined)).toBeNull();
  });
});

describe("filterConnectionsForRuleSource", () => {
  it("regra de formulário só vê linha de formulários e linha livre", () => {
    expect(filterConnectionsForRuleSource(todas, "meta_form").map((c) => c.id)).toEqual([
      "linha-livre",
      "linha-forms",
    ]);
  });

  it("regra de WhatsApp direto só vê linha direta e linha livre", () => {
    expect(filterConnectionsForRuleSource(todas, "whatsapp_organico").map((c) => c.id)).toEqual([
      "linha-livre",
      "linha-direct",
    ]);
  });

  it("origem sem finalidade não filtra nada", () => {
    expect(filterConnectionsForRuleSource(todas, "whatsapp_api")).toHaveLength(3);
    expect(filterConnectionsForRuleSource(todas, "")).toHaveLength(3);
  });

  it("linha sem campo purpose é tratada como livre", () => {
    const semCampo = [{ id: "antiga" }];
    expect(filterConnectionsForRuleSource(semCampo, "meta_form").map((c) => c.id)).toEqual(["antiga"]);
  });

  // Regressão que apagaria a conexão de regras em produção: ao editar uma regra
  // cuja linha virou incompatível, o <select> ficaria sem option correspondente
  // e o próximo save gravaria connection_id vazio.
  it("nunca filtra fora a conexão já selecionada", () => {
    const filtrada = filterConnectionsForRuleSource(todas, "meta_form", "linha-direct");
    expect(filtrada.map((c) => c.id)).toEqual(["linha-livre", "linha-forms", "linha-direct"]);
  });

  it("conexão selecionada inexistente não inventa opção", () => {
    const filtrada = filterConnectionsForRuleSource(todas, "meta_form", "linha-que-nao-existe");
    expect(filtrada.map((c) => c.id)).toEqual(["linha-livre", "linha-forms"]);
  });

  it("id vazio ou em branco não conta como seleção atual", () => {
    expect(filterConnectionsForRuleSource(todas, "meta_form", "   ").map((c) => c.id)).toEqual([
      "linha-livre",
      "linha-forms",
    ]);
  });
});

describe("isConnectionPurposeMismatch", () => {
  it("marca divergência só quando as duas pontas existem e diferem", () => {
    expect(isConnectionPurposeMismatch("direct", "meta_form")).toBe(true);
    expect(isConnectionPurposeMismatch("forms", "whatsapp_organico")).toBe(true);
    expect(isConnectionPurposeMismatch("forms", "meta_form")).toBe(false);
    expect(isConnectionPurposeMismatch(null, "meta_form")).toBe(false);
    expect(isConnectionPurposeMismatch("forms", "whatsapp_api")).toBe(false);
  });
});
