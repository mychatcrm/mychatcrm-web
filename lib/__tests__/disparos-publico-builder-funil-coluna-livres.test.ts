import { describe, expect, it } from "vitest";
import {
  toggleColumnInScope,
  toggleFunnelInScope,
  type PublicoCrmScope,
} from "@/components/dashboard/disparos/DisparosPublicoBuilder";

/**
 * Dois bugs no mesmo fluxo de "Escolher funis e colunas":
 *
 * 1) Marcar "funil inteiro" varria (e escondia) as colunas daquele mesmo
 *    funil que o cliente já tinha escolhido a dedo. Sequência que quebrava:
 *    escolhe a coluna → depois marca o funil → a coluna some sozinha.
 *
 * 2) MAIS GRAVE: marcar uma coluna de um funil marcava a MESMA coluna em
 *    TODOS os outros funis que tivessem uma etapa com o mesmo id (ex.: três
 *    funis com "Tentativa" — marcar em um marcava nos três). A raiz: colunas
 *    são reaproveitadas do modelo global de Kanban, então o id da coluna
 *    sozinho não identifica UM funil específico. A correção amarra cada
 *    coluna ao par (funnelId, columnId).
 *
 * O pedido era liberdade total: quantos funis quiser, e se quiser só uma
 * coluna de um único funil, que fique só naquele — nada pode se espalhar ou
 * se apagar sem o cliente pedir.
 */

const vazio: PublicoCrmScope = { funnelIds: [], columns: [] };

describe("BUG grave: coluna de um funil não pode marcar a mesma coluna em outros funis", () => {
  it("três funis com uma coluna de mesmo id — marcar em um não marca nos outros", () => {
    // Cenário exato relatado: "Tentativa" existe nos três funis (mesmo columnId,
    // porque vem do mesmo modelo de Kanban), mas são funis diferentes.
    let scope = toggleColumnInScope(vazio, "funil-a", "tentativa");

    expect(scope.columns).toEqual([{ funnelId: "funil-a", columnId: "tentativa" }]);

    const marcadaNoA = scope.columns.some((c) => c.funnelId === "funil-a" && c.columnId === "tentativa");
    const marcadaNoB = scope.columns.some((c) => c.funnelId === "funil-b" && c.columnId === "tentativa");
    const marcadaNoC = scope.columns.some((c) => c.funnelId === "funil-c" && c.columnId === "tentativa");

    expect(marcadaNoA).toBe(true);
    expect(marcadaNoB).toBe(false);
    expect(marcadaNoC).toBe(false);
  });

  it("marcar a mesma coluna em dois funis diferentes mantém os dois pares independentes", () => {
    let scope = toggleColumnInScope(vazio, "funil-a", "tentativa");
    scope = toggleColumnInScope(scope, "funil-b", "tentativa");

    expect(scope.columns).toHaveLength(2);
    expect(scope.columns).toContainEqual({ funnelId: "funil-a", columnId: "tentativa" });
    expect(scope.columns).toContainEqual({ funnelId: "funil-b", columnId: "tentativa" });

    // Desmarcar só a do funil A não mexe na do funil B.
    scope = toggleColumnInScope(scope, "funil-a", "tentativa");
    expect(scope.columns).toEqual([{ funnelId: "funil-b", columnId: "tentativa" }]);
  });
});

describe("cenário do outro bug: escolhe a coluna, depois marca o funil dela", () => {
  it("marcar o funil inteiro NÃO apaga a coluna já escolhida do mesmo funil", () => {
    let scope = toggleColumnInScope(vazio, "funil-vendas", "proposta");
    expect(scope.columns).toEqual([{ funnelId: "funil-vendas", columnId: "proposta" }]);

    scope = toggleFunnelInScope(scope, "funil-vendas");

    expect(scope.funnelIds).toEqual(["funil-vendas"]);
    // Era exatamente isso que sumia sozinho antes da correção.
    expect(scope.columns).toEqual([{ funnelId: "funil-vendas", columnId: "proposta" }]);
  });

  it("desmarcar o funil depois também não mexe na coluna", () => {
    let scope = toggleColumnInScope(vazio, "funil-vendas", "proposta");
    scope = toggleFunnelInScope(scope, "funil-vendas");
    scope = toggleFunnelInScope(scope, "funil-vendas");

    expect(scope.funnelIds).toEqual([]);
    expect(scope.columns).toEqual([{ funnelId: "funil-vendas", columnId: "proposta" }]);
  });
});

describe("liberdade total: quantos funis e colunas o cliente quiser", () => {
  it("marcar vários funis não interfere entre si nem nas colunas", () => {
    let scope = vazio;
    scope = toggleFunnelInScope(scope, "funil-a");
    scope = toggleFunnelInScope(scope, "funil-b");
    scope = toggleColumnInScope(scope, "funil-c", "coluna-x");

    expect(scope.funnelIds.sort()).toEqual(["funil-a", "funil-b"]);
    expect(scope.columns).toEqual([{ funnelId: "funil-c", columnId: "coluna-x" }]);
  });

  it("apenas uma coluna de um único funil, sem marcar o funil inteiro — fica exatamente assim", () => {
    const scope = toggleColumnInScope(vazio, "funil-unico", "coluna-unica");
    expect(scope.funnelIds).toEqual([]);
    expect(scope.columns).toEqual([{ funnelId: "funil-unico", columnId: "coluna-unica" }]);
  });

  it("desmarcar uma coluna não mexe nos funis marcados", () => {
    let scope = toggleFunnelInScope(vazio, "funil-a");
    scope = toggleColumnInScope(scope, "funil-b", "coluna-solta");
    scope = toggleColumnInScope(scope, "funil-b", "coluna-solta");

    expect(scope.funnelIds).toEqual(["funil-a"]);
    expect(scope.columns).toEqual([]);
  });
});
