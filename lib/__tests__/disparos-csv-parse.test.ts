import { describe, expect, it } from "vitest";
import {
  DISPAROS_IMPORT_MAX_ROWS,
  parseDisparosContactsCsv,
} from "@/lib/server/disparos-csv-parse";

/**
 * Lista que cliente manda nunca é limpa. Estes testes seguram os formatos que
 * aparecem de verdade: Excel brasileiro com `;`, telefone com máscara, arquivo
 * sem cabeçalho, nome com vírgula dentro de aspas e contato repetido.
 */

describe("parseDisparosContactsCsv", () => {
  it("lê cabeçalho em português e normaliza o telefone", () => {
    const result = parseDisparosContactsCsv("nome,telefone\nJoão Silva,5562991234567");

    expect(result.contacts).toEqual([{ name: "João Silva", phone: "5562991234567" }]);
    expect(result.invalid).toEqual([]);
  });

  it("aceita ponto e vírgula (exportação do Excel pt-BR)", () => {
    const result = parseDisparosContactsCsv("nome;telefone\nMaria;5562991234567");

    expect(result.contacts).toEqual([{ name: "Maria", phone: "5562991234567" }]);
  });

  it("aceita arquivo SEM cabeçalho, achando o telefone pela coluna com mais dígitos", () => {
    // Exigir cabeçalho seria rejeitar a lista que o cliente exportou de qualquer lugar.
    const result = parseDisparosContactsCsv("Ana Paula,5562991234567\nCarlos,5562997654321");

    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0]).toEqual({ name: "Ana Paula", phone: "5562991234567" });
  });

  it("limpa máscara de telefone", () => {
    const result = parseDisparosContactsCsv("nome,telefone\nJoão,+55 (62) 99123-4567");

    expect(result.contacts[0]?.phone).toBe("5562991234567");
  });

  it("aplica o 9º dígito para casar com o resto da plataforma", () => {
    // Sem esta normalização o mesmo contato entraria duas vezes: uma com 9,
    // outra sem — e o disparo bateria duas vezes na mesma pessoa.
    const semNove = parseDisparosContactsCsv("nome,telefone\nJoão,556291234567");
    const comNove = parseDisparosContactsCsv("nome,telefone\nJoão,5562991234567");

    expect(semNove.contacts[0]?.phone).toBe(comNove.contacts[0]?.phone);
  });

  it("não quebra nome com vírgula dentro de aspas", () => {
    const result = parseDisparosContactsCsv('nome,telefone\n"Silva, João",5562991234567');

    expect(result.contacts[0]?.name).toBe("Silva, João");
    expect(result.contacts[0]?.phone).toBe("5562991234567");
  });

  it("descarta linha sem telefone dizendo qual é", () => {
    const result = parseDisparosContactsCsv("nome,telefone\nJoão,5562991234567\nSemNumero,");

    expect(result.contacts).toHaveLength(1);
    expect(result.invalid).toEqual([
      { line: 3, raw: "SemNumero,", reason: "sem_telefone" },
    ]);
  });

  it("descarta telefone curto demais", () => {
    const result = parseDisparosContactsCsv("nome,telefone\nJoão,123");

    expect(result.contacts).toHaveLength(0);
    expect(result.invalid[0]?.reason).toBe("telefone_invalido");
  });

  it("deduplica repetido dentro do próprio arquivo, mantendo o primeiro", () => {
    const result = parseDisparosContactsCsv(
      "nome,telefone\nPrimeiro,5562991234567\nSegundo,+55 62 99123-4567",
    );

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.name).toBe("Primeiro");
    expect(result.duplicatesInFile).toBe(1);
  });

  it("corta no teto e avisa que cortou", () => {
    const linhas = Array.from(
      { length: DISPAROS_IMPORT_MAX_ROWS + 10 },
      (_, i) => `Contato ${i},556299${String(i).padStart(7, "0")}`,
    ).join("\n");
    const result = parseDisparosContactsCsv(`nome,telefone\n${linhas}`);

    expect(result.truncated).toBe(true);
    expect(result.contacts.length).toBeLessThanOrEqual(DISPAROS_IMPORT_MAX_ROWS);
  });

  it("arquivo vazio não explode", () => {
    expect(parseDisparosContactsCsv("").contacts).toEqual([]);
    expect(parseDisparosContactsCsv("\n\n  \n").contacts).toEqual([]);
  });

  it("contato sem nome entra mesmo assim", () => {
    // Telefone é o que importa pro disparo; nome vazio vira null e o template
    // cai no fallback "cliente".
    const result = parseDisparosContactsCsv("nome,telefone\n,5562991234567");

    expect(result.contacts).toEqual([{ name: null, phone: "5562991234567" }]);
  });
});
