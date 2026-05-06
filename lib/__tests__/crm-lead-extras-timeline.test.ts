import { describe, expect, it } from "vitest";
import type { ClientLead } from "@/lib/dashboard-data";
import { getLeadTimelineResolved, seedTimelineIfEmpty } from "@/lib/crm-lead-extras";

const lead: ClientLead = {
  id: "l1",
  funilId: "f",
  dataEntradaISO: "2026-01-15",
  nome: "A",
  empresa: "B",
  telefone: "1",
  email: "a@b.co",
  valor: 1,
  status: "novo",
  tag: "t",
  agenteEntrada: "x",
  agenteAtendendo: "x",
  responsavel: "r",
  ultimoContato: "hoje",
  proximaAcao: "p",
  origem: "o",
  tags: [],
};

describe("crm lead timeline", () => {
  it("seedTimelineIfEmpty returns empty array", () => {
    expect(seedTimelineIfEmpty(lead, undefined)).toEqual([]);
  });

  it("getLeadTimelineResolved returns empty when no persisted timeline", () => {
    expect(getLeadTimelineResolved({ tasks: {}, timeline: {}, notes: {} }, lead)).toEqual([]);
  });
});
