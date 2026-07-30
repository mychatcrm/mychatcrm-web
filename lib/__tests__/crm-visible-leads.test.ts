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
    tag: patch.tag ?? "WhatsApp",
    agenteEntrada: "ag-max-vendas",
    agenteAtendendo: "ag-max-vendas",
    responsavel: "Equipe",
    ultimoContato: "Agora",
    proximaAcao: "Qualificar interesse",
    origem: patch.origem ?? "WhatsApp",
    tags: patch.tags ?? ["WhatsApp"],
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

  it("falls back unknown statuses to novo when available", () => {
    const [normalized] = normalizeLeadsForVisibleCrmFunnel([lead({ status: "etapa-inexistente" })], DEFAULT_CRM_FUNNELS);
    expect(normalized?.status).toBe("novo");
  });

  it('keeps lead with status "novo" on the novo column after stale funnel migration', () => {
    const staleFunnel = {
      id: "funil-default",
      nome: "Principal",
      columns: [
        { id: "contato", title: "Em Contato" },
        { id: "proposta", title: "Proposta Enviada" },
      ],
    };
    const [normalized] = normalizeLeadsForVisibleCrmFunnel(
      [lead({ id: "d5995060", nome: "Renato Lagares", status: "novo" })],
      [staleFunnel],
    );
    expect(normalized?.status).toBe("novo");
  });

  it("prefers funil-default as the initial visible funnel", () => {
    expect(preferredDefaultCrmFunnelId(DEFAULT_CRM_FUNNELS)).toBe("funil-default");
  });

  // A exceção que deixava lead automático sem dono visível a todos foi removida:
  // como a ingestão nunca preenchia ownerEmployeeId, ela tornava todo lead de
  // WhatsApp/Meta visível para qualquer vendedor. Agora a origem do lead não
  // influencia a visibilidade — só o dono (e, no servidor, a equipe).
  it("hides unassigned WhatsApp leads from hierarchy-scoped CRM sessions", () => {
    const visible = filterLeadsForSession(directorSession, [], [lead({ ownerEmployeeId: undefined })]);
    expect(visible).toHaveLength(0);
  });

  it("hides unassigned Meta Lead Ads leads from hierarchy-scoped CRM sessions", () => {
    const visible = filterLeadsForSession(directorSession, [], [
      lead({
        id: "d5995060-8fac-4bcc-87e5-0c5d9f3d9e51",
        nome: "Renato Lagares",
        origem: "Meta / Facebook",
        tag: "Meta",
        tags: ["Meta", "Formulário"],
        ownerEmployeeId: undefined,
      }),
    ]);
    expect(visible).toHaveLength(0);
  });

  it("hides manual unassigned leads from hierarchy-scoped CRM sessions", () => {
    const visible = filterLeadsForSession(directorSession, [], [
      lead({
        origem: "Entrada manual",
        tag: "Manual",
        tags: ["Manual"],
        ownerEmployeeId: undefined,
      }),
    ]);
    expect(visible).toHaveLength(0);
  });

  it("keeps leads owned by the scoped employee, regardless of origin", () => {
    const visible = filterLeadsForSession(directorSession, [], [
      lead({ ownerEmployeeId: "emp-director" }),
      lead({ id: "lead-2", ownerEmployeeId: "emp-outro" }),
    ]);
    expect(visible.map((l) => l.ownerEmployeeId)).toEqual(["emp-director"]);
  });
});
