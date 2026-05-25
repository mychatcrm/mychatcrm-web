import { describe, expect, it } from "vitest";
import { KANBAN_COLUMNS } from "@/lib/constants";
import type { CrmFunnel, CrmFunnelColumn } from "@/lib/crm-funnels";
import {
  migrateCrmFunnelsFromLocalStorage,
  migrateFunnelColumns,
  resolveLeadStatusForFunnelColumns,
} from "@/lib/crm-funnel-migration";
import { normalizeColunaInicialForFunnel } from "@/lib/crm-funnels";
import { normalizeLeadsForVisibleCrmFunnel } from "@/lib/crm-visible-leads";
import type { ClientLead } from "@/lib/dashboard-data";

function funnel(columns: CrmFunnelColumn[], id = "funil-default"): CrmFunnel {
  return { id, nome: "Principal", columns };
}

function lead(patch: Partial<ClientLead>): ClientLead {
  return {
    id: patch.id ?? "d5995060",
    funilId: patch.funilId ?? "funil-default",
    dataEntradaISO: "2026-05-13",
    nome: patch.nome ?? "Renato Lagares",
    empresa: "—",
    telefone: "5562999999999",
    email: "—",
    valor: 0,
    status: patch.status ?? "novo",
    tag: "WhatsApp",
    agenteEntrada: "ag-max-vendas",
    agenteAtendendo: "ag-max-vendas",
    responsavel: "Equipe",
    ultimoContato: "Agora",
    proximaAcao: "Qualificar",
    origem: "WhatsApp",
    tags: [],
    ...patch,
  };
}

describe("crm-funnel-migration", () => {
  it('migrates legacy title "Em Contato" to official "Em atendimento" on column contato', () => {
    const cols = migrateFunnelColumns([
      { id: "novo", title: "Novo Lead" },
      { id: "contato", title: "Em Contato" },
      { id: "proposta", title: "Proposta Enviada" },
    ]);
    const contato = cols.find((c) => c.id === "contato");
    expect(contato?.title).toBe("Em atendimento");
  });

  it('adds missing "novo" column from KANBAN_COLUMNS', () => {
    const cols = migrateFunnelColumns([
      { id: "contato", title: "Em Contato" },
      { id: "proposta", title: "Proposta Enviada" },
    ]);
    expect(cols.some((c) => c.id === "novo")).toBe(true);
    expect(cols.find((c) => c.id === "novo")?.title).toBe("Novo Lead");
    expect(cols.length).toBeGreaterThanOrEqual(KANBAN_COLUMNS.length);
  });

  it("preserves custom col-* columns", () => {
    const custom: CrmFunnelColumn = { id: "col-abc123", title: "Pós-venda" };
    const cols = migrateFunnelColumns([...KANBAN_COLUMNS.map((c) => ({ ...c })), custom]);
    expect(cols.some((c) => c.id === "col-abc123" && c.title === "Pós-venda")).toBe(true);
  });

  it("uses fallback funnels when storage is corrupt", () => {
    const { funnels, changed } = migrateCrmFunnelsFromLocalStorage([]);
    expect(changed).toBe(true);
    expect(funnels[0]?.id).toBe("funil-default");
    expect(funnels[0]?.columns.some((c) => c.id === "novo")).toBe(true);
  });

  it('maps lead status "novo" to column "novo"', () => {
    const f = funnel(migrateFunnelColumns([{ id: "contato", title: "Em Contato" }]));
    expect(normalizeColunaInicialForFunnel("novo", f)).toBe("novo");
  });

  it('keeps lead status "novo" visible in Kanban normalization', () => {
    const stale = funnel([
      { id: "contato", title: "Em Contato" },
      { id: "proposta", title: "Proposta" },
    ]);
    const [normalized] = normalizeLeadsForVisibleCrmFunnel([lead({ status: "novo" })], [stale]);
    expect(normalized?.status).toBe("novo");
    expect(normalized?.funilId).toBe("funil-default");
  });

  it("does not hide lead with unknown status — remaps to novo", () => {
    const f = funnel(migrateFunnelColumns(KANBAN_COLUMNS.map((c) => ({ ...c }))));
    const status = resolveLeadStatusForFunnelColumns("etapa-inexistente", f.columns);
    expect(status).toBe("novo");
    const [normalized] = normalizeLeadsForVisibleCrmFunnel([lead({ status: "etapa-inexistente" })], [f]);
    expect(f.columns.some((c) => c.id === normalized?.status)).toBe(true);
  });

  it("syncs base column titles with constants.ts", () => {
    const cols = migrateFunnelColumns(
      KANBAN_COLUMNS.map((c) => ({ id: c.id, title: c.id === "contato" ? "Em Contato" : c.title })),
    );
    for (const base of KANBAN_COLUMNS) {
      expect(cols.find((c) => c.id === base.id)?.title).toBe(base.title);
    }
  });
});
