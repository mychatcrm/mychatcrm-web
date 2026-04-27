import type { ClientLead } from "@/lib/dashboard-data";

export type CrmLeadAppliedFilters = {
  atendente: string;
  semAtendente: boolean;
  clienteText: string;
  tipoMidia: string;
  marketing: string;
  tagAtendimento: string;
  /** Quando vazio, todas as colunas; caso contrário, apenas `status` nesta lista. */
  kanbanStages: string[];
  dataConsiderar: "entrada";
  periodoDe: string;
  periodoAte: string;
  validade: "todos" | "com_proxima" | "sem_proxima";
  termometro: "todos" | "quente" | "morno" | "frio";
  agenteIa: string;
};

export const EMPTY_CRM_LEAD_FILTERS: CrmLeadAppliedFilters = {
  atendente: "",
  semAtendente: false,
  clienteText: "",
  tipoMidia: "",
  marketing: "",
  tagAtendimento: "",
  kanbanStages: [],
  dataConsiderar: "entrada",
  periodoDe: "",
  periodoAte: "",
  validade: "todos",
  termometro: "todos",
  agenteIa: "",
};

export function leadHasNoAttendant(lead: ClientLead): boolean {
  const r = lead.responsavel.trim();
  return !r || r.toLowerCase() === "equipe";
}

export function applyCrmLeadFilters(base: ClientLead[], f: CrmLeadAppliedFilters): ClientLead[] {
  const cliente = f.clienteText.trim().toLowerCase();
  const tipo = f.tipoMidia.trim().toLowerCase();
  const tagQ = f.tagAtendimento.trim().toLowerCase();

  return base.filter((lead) => {
    if (f.semAtendente && !leadHasNoAttendant(lead)) return false;
    if (f.atendente && lead.responsavel !== f.atendente) return false;
    if (cliente) {
      const t = `${lead.nome} ${lead.empresa} ${lead.email} ${lead.telefone}`.toLowerCase();
      if (!t.includes(cliente)) return false;
    }
    if (tipo && !lead.tag.toLowerCase().includes(tipo)) return false;
    if (f.marketing && lead.origem !== f.marketing) return false;
    if (tagQ) {
      const hay = `${lead.tag} ${lead.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(tagQ)) return false;
    }
    if (f.kanbanStages.length && !f.kanbanStages.includes(lead.status)) return false;
    if (f.periodoDe && lead.dataEntradaISO && lead.dataEntradaISO < f.periodoDe) return false;
    if (f.periodoAte && lead.dataEntradaISO && lead.dataEntradaISO > f.periodoAte) return false;
    if (f.validade === "com_proxima" && !lead.proximaAcao?.trim()) return false;
    if (f.validade === "sem_proxima" && !!lead.proximaAcao?.trim()) return false;
    if (f.termometro === "quente" && lead.valor < 8000) return false;
    if (f.termometro === "morno" && (lead.valor < 4000 || lead.valor >= 8000)) return false;
    if (f.termometro === "frio" && lead.valor >= 4000) return false;
    if (f.agenteIa.trim() && lead.agenteAtendendo !== f.agenteIa) return false;
    return true;
  });
}
