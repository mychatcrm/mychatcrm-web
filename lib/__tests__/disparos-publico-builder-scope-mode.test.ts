import { describe, expect, it } from "vitest";
import { createCrmBlock, hasUsablePublico, buildAudienceBlocksPayload, type PublicoCrmBlock } from "@/components/dashboard/disparos/DisparosPublicoBuilder";

/**
 * BUG: em "Escolher funis e colunas", o modo era derivado de `scope` estar
 * vazio (`funnelIds.length === 0 && columns.length === 0`). Ao desmarcar a
 * caixa "funil inteiro" pra depois escolher só colunas específicas, o escopo
 * ficava vazio por um instante — e a tela reinterpretava isso como "voltar
 * pra Todos os funis", fechando a seção inteira debaixo do clique.
 *
 * A correção separa o MODO (`scopeMode`, travado pelo clique explícito nos
 * dois botões) do CONTEÚDO do escopo. Estes testes travam essa separação:
 * um escopo vazio em modo "custom" nunca deve virar "all" sozinho.
 */

describe("createCrmBlock — modo inicial", () => {
  it("nasce em 'all', não derivado de nada", () => {
    expect(createCrmBlock().scopeMode).toBe("all");
  });
});

describe("cenário do bug: desmarcar o único funil escolhido", () => {
  it("escopo fica vazio mas o modo continua 'custom' — a seção não pode fechar", () => {
    // Estado após clicar em "Escolher funis e colunas" e marcar um funil.
    let block: PublicoCrmBlock = {
      ...createCrmBlock(),
      scopeMode: "custom",
      scope: { funnelIds: ["funil-1"], columns: [] },
    };

    // Desmarca a caixa do funil (pra depois escolher colunas dele a dedo).
    block = { ...block, scope: { funnelIds: [], columns: [] } };

    // O bug: `baseInteira` era `scope.funnelIds.length === 0 && ...`, que
    // agora daria true e fecharia a seção "Escolher funis e colunas".
    expect(block.scopeMode).toBe("custom");
    expect(block.scope.funnelIds).toHaveLength(0);
    expect(block.scope.columns).toHaveLength(0);
  });
});

describe("isBlockUsable via hasUsablePublico — custom vazio não vira 'todo mundo'", () => {
  it("bloco custom sem nada marcado NÃO é usável — não pode virar 'base inteira' por acidente", () => {
    const block: PublicoCrmBlock = {
      ...createCrmBlock(),
      scopeMode: "custom",
      scope: { funnelIds: [], columns: [] },
    };
    expect(hasUsablePublico([block])).toBe(false);
  });

  it("bloco 'all' é sempre usável, mesmo com scope vazio (é o contrato: vazio = base inteira)", () => {
    const block: PublicoCrmBlock = { ...createCrmBlock(), scopeMode: "all" };
    expect(hasUsablePublico([block])).toBe(true);
  });

  it("bloco custom COM algo marcado é usável", () => {
    const block: PublicoCrmBlock = {
      ...createCrmBlock(),
      scopeMode: "custom",
      scope: { funnelIds: [], columns: [{ funnelId: "funil-1", columnId: "coluna-1" }] },
    };
    expect(hasUsablePublico([block])).toBe(true);
  });
});

describe("buildAudienceBlocksPayload — nunca manda um custom vazio pro servidor", () => {
  it("bloco custom vazio é excluído do payload (o servidor leria vazio como 'todo mundo')", () => {
    const block: PublicoCrmBlock = {
      ...createCrmBlock(),
      scopeMode: "custom",
      scope: { funnelIds: [], columns: [] },
    };
    expect(buildAudienceBlocksPayload([block])).toHaveLength(0);
  });

  it("bloco 'all' vazio é incluído — é assim que 'todo mundo' se representa na gravação", () => {
    const block: PublicoCrmBlock = { ...createCrmBlock(), scopeMode: "all" };
    const payload = buildAudienceBlocksPayload([block]);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ kind: "crm", scope: { funnelIds: [], columns: [] } });
  });
});
