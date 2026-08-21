import { describe, expect, it } from "vitest";
import {
  toggleColumnInScope,
  toggleFunnelInScope,
  type PublicoCrmScope,
} from "@/components/dashboard/disparos/DisparosPublicoBuilder";

/**
 * BUG: marcar "funil inteiro" varria (e escondia) as colunas daquele mesmo
 * funil que o cliente já tinha escolhido a dedo. Sequência que quebrava:
 * escolhe a coluna → depois marca o funil → a coluna some sozinha.
 *
 * O pedido era liberdade total: quantos funis quiser, e se quiser só uma
 * coluna de um único funil, que fique — nada pode apagar a escolha de
 * ninguém sem ser pedido.
 */

const vazio: PublicoCrmScope = { funnelIds: [], columnIds: [] };

describe("cenário exato do bug: escolhe a coluna, depois marca o funil dela", () => {
  it("marcar o funil inteiro NÃO apaga a coluna já escolhida do mesmo funil", () => {
    let scope = toggleColumnInScope(vazio, "coluna-proposta");
    expect(scope.columnIds).toEqual(["coluna-proposta"]);

    scope = toggleFunnelInScope(scope, "funil-vendas");

    expect(scope.funnelIds).toEqual(["funil-vendas"]);
    // Era exatamente isso que sumia sozinho antes da correção.
    expect(scope.columnIds).toEqual(["coluna-proposta"]);
  });

  it("desmarcar o funil depois também não mexe na coluna", () => {
    let scope = toggleColumnInScope(vazio, "coluna-proposta");
    scope = toggleFunnelInScope(scope, "funil-vendas");
    scope = toggleFunnelInScope(scope, "funil-vendas");

    expect(scope.funnelIds).toEqual([]);
    expect(scope.columnIds).toEqual(["coluna-proposta"]);
  });
});

describe("liberdade total: quantos funis e colunas o cliente quiser", () => {
  it("marcar vários funis não interfere entre si nem nas colunas", () => {
    let scope = vazio;
    scope = toggleFunnelInScope(scope, "funil-a");
    scope = toggleFunnelInScope(scope, "funil-b");
    scope = toggleColumnInScope(scope, "coluna-x-do-funil-c");

    expect(scope.funnelIds.sort()).toEqual(["funil-a", "funil-b"]);
    expect(scope.columnIds).toEqual(["coluna-x-do-funil-c"]);
  });

  it("apenas uma coluna de um único funil, sem marcar o funil inteiro — fica exatamente assim", () => {
    const scope = toggleColumnInScope(vazio, "coluna-unica");
    expect(scope.funnelIds).toEqual([]);
    expect(scope.columnIds).toEqual(["coluna-unica"]);
  });

  it("desmarcar uma coluna não mexe nos funis marcados", () => {
    let scope = toggleFunnelInScope(vazio, "funil-a");
    scope = toggleColumnInScope(scope, "coluna-solta");
    scope = toggleColumnInScope(scope, "coluna-solta");

    expect(scope.funnelIds).toEqual(["funil-a"]);
    expect(scope.columnIds).toEqual([]);
  });
});
