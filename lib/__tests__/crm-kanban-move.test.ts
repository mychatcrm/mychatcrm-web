import { describe, expect, it } from "vitest";
import type { ClientLead } from "@/lib/dashboard-data";
import {
  calculateCrmKanbanMove,
  CRM_KANBAN_COLUMN_DROPPABLE_PREFIX,
} from "@/lib/crm-kanban-move";

function lead(id: string, status: string, funilId = "funil-default"): ClientLead {
  return {
    id,
    funilId,
    dataEntradaISO: "2026-08-11",
    nome: id.toUpperCase(),
    empresa: "—",
    telefone: "—",
    email: "—",
    valor: 0,
    status,
    tag: "Novo",
    agenteEntrada: "Agente",
    agenteAtendendo: "Agente",
    responsavel: "Equipe",
    ultimoContato: "Agora",
    proximaAcao: "Qualificar",
    origem: "Manual",
    tags: [],
  };
}

const idsIn = (leads: ClientLead[], status: string, funnelId = "funil-default") =>
  leads.filter((item) => item.funilId === funnelId && item.status === status).map((item) => item.id);

describe("calculateCrmKanbanMove", () => {
  it("reordena dentro da mesma coluna e devolve os vizinhos persistíveis", () => {
    const result = calculateCrmKanbanMove({
      leads: [lead("a", "novo"), lead("b", "novo"), lead("c", "novo")],
      activeId: "a",
      overId: "c",
      funnelId: "funil-default",
      allowedStatusIds: ["novo", "contato"],
    });

    expect(result).not.toBeNull();
    expect(idsIn(result!.nextLeads, "novo")).toEqual(["b", "c", "a"]);
    expect(result).toMatchObject({
      previousLeadId: "c",
      nextLeadId: null,
      changedColumn: false,
    });
  });

  it("insere antes do card apontado em outra coluna", () => {
    const result = calculateCrmKanbanMove({
      leads: [lead("a", "novo"), lead("c", "contato"), lead("d", "contato")],
      activeId: "a",
      overId: "d",
      funnelId: "funil-default",
      allowedStatusIds: ["novo", "contato"],
    });

    expect(idsIn(result!.nextLeads, "novo")).toEqual([]);
    expect(idsIn(result!.nextLeads, "contato")).toEqual(["c", "a", "d"]);
    expect(result).toMatchObject({
      targetStatus: "contato",
      previousLeadId: "c",
      nextLeadId: "d",
      changedColumn: true,
    });
  });

  it("anexa ao fim ao soltar diretamente na coluna", () => {
    const result = calculateCrmKanbanMove({
      leads: [lead("a", "novo"), lead("c", "contato"), lead("d", "contato")],
      activeId: "a",
      overId: `${CRM_KANBAN_COLUMN_DROPPABLE_PREFIX}contato`,
      funnelId: "funil-default",
      allowedStatusIds: ["novo", "contato"],
    });

    expect(idsIn(result!.nextLeads, "contato")).toEqual(["c", "d", "a"]);
    expect(result).toMatchObject({ previousLeadId: "d", nextLeadId: null });
  });

  it("não altera cards de outros funis", () => {
    const other = lead("x", "novo", "funil-outro");
    const result = calculateCrmKanbanMove({
      leads: [other, lead("a", "novo"), lead("b", "contato")],
      activeId: "a",
      overId: "b",
      funnelId: "funil-default",
      allowedStatusIds: ["novo", "contato"],
    });

    expect(result!.nextLeads.find((item) => item.id === "x")).toEqual(other);
  });

  it("nega alvo inexistente, outro funil e drop sem mudança", () => {
    const leads = [lead("a", "novo"), lead("b", "novo"), lead("x", "novo", "funil-outro")];
    const base = { leads, activeId: "a", funnelId: "funil-default", allowedStatusIds: ["novo"] };

    expect(calculateCrmKanbanMove({ ...base, overId: "a" })).toBeNull();
    expect(calculateCrmKanbanMove({ ...base, overId: "ausente" })).toBeNull();
    expect(calculateCrmKanbanMove({ ...base, overId: "x" })).toBeNull();
    expect(calculateCrmKanbanMove({ ...base, overId: `${CRM_KANBAN_COLUMN_DROPPABLE_PREFIX}novo` })).toBeNull();
  });
});
