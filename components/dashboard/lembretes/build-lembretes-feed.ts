import type { DashboardDataset, ClientLead } from "@/lib/dashboard-data";
import type { CrmFunnel } from "@/lib/crm-funnels";
import { funnelColumnTitle } from "@/lib/crm-funnels";
import { getLeadTimelineResolved, type CrmLeadExtrasStore } from "@/lib/crm-lead-extras";
import type { AgendaEventRecord } from "@/components/dashboard/agenda/agenda-storage";
import type { DisparosDraft } from "@/components/dashboard/disparos/disparos-drafts-storage";

export type LembretesPulseItem = {
  id: string;
  source:
    | "agenda"
    | "crm-tarefa"
    | "crm-lead"
    | "crm-atividade"
    | "disparo"
    | "alerta"
    | "resumo-agenda"
    | "regra"
    | "campanha";
  label: string;
  title: string;
  detail?: string;
  at: Date | null;
  href?: string;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sortPulse(items: LembretesPulseItem[]): LembretesPulseItem[] {
  const start = startOfToday();
  const withDate = items.filter((i) => i.at);
  const without = items.filter((i) => !i.at);
  const upcoming = withDate.filter((i) => i.at! >= start).sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const past = withDate.filter((i) => i.at! < start).sort((a, b) => b.at!.getTime() - a.at!.getTime());
  return [...upcoming, ...past, ...without.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))];
}

function funnelForLead(funnels: CrmFunnel[], lead: ClientLead) {
  return funnels.find((f) => f.id === lead.funilId) ?? funnels[0];
}

export function buildLembretesFeed(input: {
  dataset: DashboardDataset;
  /** Leads efetivos do CRM Kanban (ex.: snapshot local alinhado ao quadro). */
  leads: ClientLead[];
  funnels: CrmFunnel[];
  extras: CrmLeadExtrasStore;
  agendaEvents: AgendaEventRecord[];
  disparosDrafts: DisparosDraft[];
}): LembretesPulseItem[] {
  const { dataset, leads, funnels, extras, agendaEvents, disparosDrafts } = input;
  const items: LembretesPulseItem[] = [];
  const activityCutoff = addDays(startOfToday(), -30);

  for (const ev of agendaEvents) {
    const at = new Date(ev.startISO);
    if (Number.isNaN(at.getTime())) continue;
    items.push({
      id: `ag-${ev.id}`,
      source: "agenda",
      label: "Agenda",
      title: ev.title,
      detail: [ev.kind, ev.notifyWa ? "Lembrete WhatsApp" : null].filter(Boolean).join(" · ") || undefined,
      at,
      href: "/dashboard/agenda",
    });
  }

  for (const lead of leads) {
    const funnel = funnelForLead(funnels, lead);
    const colTitle = funnelColumnTitle(funnel, lead.status);
    items.push({
      id: `lead-${lead.id}-proxima`,
      source: "crm-lead",
      label: "CRM Kanban",
      title: `Proxima acao · ${lead.nome}`,
      detail: `${lead.empresa} · ${colTitle} — ${lead.proximaAcao}`,
      at: null,
      href: "/dashboard/crm",
    });
  }

  for (const lead of leads) {
    const funnel = funnelForLead(funnels, lead);
    const tasks = extras.tasks[lead.id] ?? [];
    for (const task of tasks) {
      if (!task.due) continue;
      const raw = task.due.includes("T") ? task.due : `${task.due}T12:00:00`;
      const at = new Date(raw);
      if (Number.isNaN(at.getTime())) continue;
      items.push({
        id: `task-${lead.id}-${task.id}`,
        source: "crm-tarefa",
        label: "Tarefa · CRM Kanban",
        title: task.done ? `[Concluida] ${task.title}` : task.title,
        detail: `${lead.nome} · ${lead.empresa}`,
        at,
        href: "/dashboard/crm",
      });
    }

    const tl = getLeadTimelineResolved(extras, lead);
    const rows = tl.filter((row) => {
      if (row.tipo !== "followup" && row.tipo !== "pipeline") return false;
      const at = new Date(row.at);
      if (Number.isNaN(at.getTime()) || at < activityCutoff) return false;
      return true;
    });
    const lastRows = rows.slice(-8);
    for (const row of lastRows) {
      const at = new Date(row.at);
      items.push({
        id: `tl-${lead.id}-${row.id}`,
        source: "crm-atividade",
        label: row.tipo === "pipeline" ? "Funil" : "Follow-up",
        title: row.titulo ?? (row.tipo === "pipeline" ? "Mudanca de etapa" : "Follow-up"),
        detail: `${lead.nome}: ${row.texto.length > 140 ? `${row.texto.slice(0, 140)}…` : row.texto}`,
        at,
        href: "/dashboard/crm",
      });
    }
  }

  dataset.agendaItems.forEach((line, i) => {
    items.push({
      id: `agenda-ov-${i}`,
      source: "resumo-agenda",
      label: "Agenda (visao)",
      title: line,
      detail: "Sincronizado com o resumo do tenant (overview)",
      at: null,
      href: "/dashboard/agenda",
    });
  });

  dataset.alerts.forEach((text, i) => {
    items.push({
      id: `alert-${i}`,
      source: "alerta",
      label: "Sistema",
      title: text,
      at: null,
      href: "/dashboard/overview",
    });
  });

  for (const d of disparosDrafts) {
    let at: Date | null = null;
    if (d.schedule) {
      const parsed = new Date(d.schedule);
      if (!Number.isNaN(parsed.getTime())) at = parsed;
    }
    items.push({
      id: `disp-${d.id}`,
      source: "disparo",
      label: "Disparos",
      title: d.name,
      detail: at ? `Disparo agendado · ritmo ${d.throughput}` : `Rascunho · ritmo ${d.throughput}`,
      at,
      href: "/dashboard/disparos",
    });
  }

  dataset.reminderItems.forEach((text, i) => {
    items.push({
      id: `regra-${i}`,
      source: "regra",
      label: "Automacao",
      title: text,
      at: null,
    });
  });

  dataset.campaignItems.forEach((name, i) => {
    items.push({
      id: `camp-${i}`,
      source: "campanha",
      label: "Campanha",
      title: name,
      detail: "Acompanhe em Disparos em massa",
      at: null,
      href: "/dashboard/disparos",
    });
  });

  return sortPulse(items);
}
