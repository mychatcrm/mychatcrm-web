import { describe, expect, it } from "vitest";
import type { ClientLead } from "@/lib/dashboard-data";
import { buildOperacaoInboxView } from "@/lib/operacao-inbox";

const minimalLead: ClientLead = {
  id: "t1",
  funilId: "f1",
  dataEntradaISO: "2026-05-01",
  nome: "Test User",
  empresa: "Co",
  telefone: "11999999999",
  email: "t@e.com",
  valor: 0,
  status: "novo",
  tag: "",
  agenteEntrada: "Bot",
  agenteAtendendo: "Bot",
  responsavel: "Owner",
  ultimoContato: "Hoje",
  proximaAcao: "—",
  origem: "WhatsApp",
  tags: [],
};

describe("buildOperacaoInboxView", () => {
  it("does not seed demo messages when thread is empty", () => {
    const view = buildOperacaoInboxView("tenant-x", [minimalLead], { ignorePersisted: true });
    expect(view.conversations).toHaveLength(1);
    const c = view.conversations[0]!;
    expect(c.messages).toEqual([]);
    expect(c.lastPreview).toBe("Sem mensagens ainda");
    expect(c.unread).toBe(0);
    const joined = JSON.stringify(c);
    expect(joined.toLowerCase()).not.toContain("demonstração");
    expect(joined.toLowerCase()).not.toContain("demonstracao");
  });
});
