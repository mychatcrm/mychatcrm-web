import { describe, expect, it } from "vitest";
import { KANBAN_COLUMNS } from "@/lib/constants";
import type { CrmFunnel, CrmFunnelColumn } from "@/lib/crm-funnels";
import { persistCrmFunnels } from "@/lib/crm-funnels";
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

  it('adds missing "novo" column without reintroducing removed official stages', () => {
    const cols = migrateFunnelColumns([
      { id: "contato", title: "Em Contato" },
      { id: "proposta", title: "Proposta Enviada" },
    ]);
    expect(cols.map((c) => c.id)).toEqual(["novo", "contato", "proposta"]);
    expect(cols.find((c) => c.id === "novo")?.title).toBe("Novo Lead");
    expect(cols.length).toBe(3);
  });

  it("preserves user-defined column order after reorder", () => {
    const reordered = [
      { id: "proposta", title: "Proposta Enviada" },
      { id: "novo", title: "Novo Lead" },
      { id: "contato", title: "Em atendimento" },
    ];
    const cols = migrateFunnelColumns(reordered);
    expect(cols.map((c) => c.id)).toEqual(["proposta", "novo", "contato"]);
  });

  it("preserves user rename on official columns", () => {
    const cols = migrateFunnelColumns([
      { id: "novo", title: "Entrada" },
      { id: "contato", title: "Qualificação" },
      { id: "proposta", title: "Proposta" },
    ]);
    expect(cols.find((c) => c.id === "contato")?.title).toBe("Qualificação");
  });

  it("does not reintroduce removed official columns", () => {
    const trimmed = [
      { id: "novo", title: "Novo Lead" },
      { id: "contato", title: "Em atendimento" },
      { id: "proposta", title: "Proposta Enviada" },
    ];
    const cols = migrateFunnelColumns(trimmed);
    expect(cols.some((c) => c.id === "perdido")).toBe(false);
    expect(cols.some((c) => c.id === "fechado")).toBe(false);
    expect(cols.length).toBe(3);
  });

  it("persists reorder through migrateCrmFunnelsFromLocalStorage round-trip", () => {
    const input: CrmFunnel[] = [
      {
        id: "funil-default",
        nome: "Principal",
        columns: [
          { id: "negociacao", title: "Negociação" },
          { id: "novo", title: "Novo Lead" },
          { id: "contato", title: "Em atendimento" },
        ],
      },
    ];
    const { funnels } = migrateCrmFunnelsFromLocalStorage(input);
    expect(funnels[0]?.columns.map((c) => c.id)).toEqual(["negociacao", "novo", "contato"]);
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
    expect(funnels[0]?.columns.length).toBe(KANBAN_COLUMNS.length);
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

  it("syncs base column titles with constants.ts for legacy titles only", () => {
    const cols = migrateFunnelColumns(
      KANBAN_COLUMNS.map((c) => ({ id: c.id, title: c.id === "contato" ? "Em Contato" : c.title })),
    );
    for (const base of KANBAN_COLUMNS) {
      expect(cols.find((c) => c.id === base.id)?.title).toBe(base.title);
    }
  });

  it("full template mode restores all official columns", () => {
    const cols = migrateFunnelColumns(
      [{ id: "novo", title: "Novo Lead" }, { id: "contato", title: "Em atendimento" }],
      { template: "full" },
    );
    expect(cols.length).toBe(KANBAN_COLUMNS.length);
    expect(cols.map((c) => c.id)).toEqual(KANBAN_COLUMNS.map((c) => c.id));
  });
});

describe("persistCrmFunnels", () => {
  it("does not reorder columns when persisting user funnel config", () => {
    if (typeof window === "undefined") return;
    const custom: CrmFunnel[] = [
      {
        id: "funil-default",
        nome: "Principal",
        columns: [
          { id: "fechado", title: "Fechado ✓" },
          { id: "novo", title: "Novo Lead" },
          { id: "contato", title: "Em atendimento" },
        ],
      },
    ];
    persistCrmFunnels(custom);
    const raw = window.localStorage.getItem("mychatcrm-crm-funnels-v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as CrmFunnel[];
    expect(parsed[0]?.columns.map((c) => c.id)).toEqual(["fechado", "novo", "contato"]);
  });
});
