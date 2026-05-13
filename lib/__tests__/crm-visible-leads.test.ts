import { describe, expect, it } from "vitest";
import { DEFAULT_CRM_FUNNELS } from "@/lib/crm-funnels";
import { normalizeLeadsForVisibleCrmFunnel, preferredDefaultCrmFunnelId } from "@/lib/crm-visible-leads";
import { filterLeadsForSession } from "@/lib/organization-hierarchy";
import type { ClientSession } from "@/lib/client-auth";
import type { ClientLead } from "@/lib/dashboard-data";

function lead(patch: Partial<ClientLead>): ClientLead {
  return {
    id: patch.id ?? "lead-1",
    funilId: patch.funilId ?? "funil-default",
    dataEntradaISO: "2026-05-13",
    nome: "Lead WhatsApp",
    empresa: "—",
    telefone: "556293580574",
    email: "—",
    valor: 0,
    status: patch.status ?? "contato",
    tag: "WhatsApp",
    agenteEntrada: "ag-max-vendas",
    agenteAtendendo: "ag-max-vendas",
    responsavel: "Equipe",
    ultimoContato: "Agora",
    proximaAcao: "Qualificar interesse",
    origem: patch.origem ?? "WhatsApp",
    tags: ["WhatsApp"],
    ownerEmployeeId: patch.ownerEmployeeId,
  };
}

const directorSession: ClientSession = {
  token: "test",
  tenantId: "tenant-a",
  email: "director@example.com",
  displayName: "Director",
  companyName: "Tenant",
  plan: "equipa",
  planLabel: "Equipa",
  initials: "DI",
  status: "ativa",
  organizationRole: "director",
  employeeId: "emp-director",
};

describe("CRM visible leads", () => {
  it("keeps a WhatsApp lead with status contato in the default funnel column", () => {
    const [normalized] = normalizeLeadsForVisibleCrmFunnel([lead({ status: "contato" })], DEFAULT_CRM_FUNNELS);
    expect(normalized).toMatchObject({
      funilId: "funil-default",
      status: "contato",
      origem: "WhatsApp",
    });
  });

  it("falls back unknown statuses to the first Kanban stage", () => {
    const [normalized] = normalizeLeadsForVisibleCrmFunnel([lead({ status: "etapa-inexistente" })], DEFAULT_CRM_FUNNELS);
    expect(normalized?.status).toBe("novo");
  });

  it("prefers funil-default as the initial visible funnel", () => {
    expect(preferredDefaultCrmFunnelId(DEFAULT_CRM_FUNNELS)).toBe("funil-default");
  });

  it("does not hide unassigned WhatsApp leads for hierarchy-scoped CRM sessions", () => {
    const visible = filterLeadsForSession(directorSession, [], [lead({ ownerEmployeeId: undefined })]);
    expect(visible).toHaveLength(1);
  });
});
